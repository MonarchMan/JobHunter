import { logDiagnostic } from '../logging/context.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { canonicalJson, hashCanonical, sha256 } from './canonical.js';
import { agentDefinitionHash, type AgentDefinition } from './definition.js';
import {
  AgentRuntimeError,
  ModelClientError,
  classifyAgentError,
  sanitizeAgentErrorSummary,
} from './errors.js';
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelToolResult,
  ModelUsage,
} from './model-client.js';
import type { AgentRunRecord, AgentRunStore, AgentRunUsage, AgentExecution } from './store.js';
import { ToolRegistry } from './tools.js';

/** 模块数据结构或契约。 */
export interface AgentRunnerResult<TOutput> {
  readonly run: AgentRunRecord;
  readonly output: TOutput;
  readonly cacheHit: boolean;
}

/** 模块数据结构或契约。 */
interface Totals {
  billingCalls: NonNullable<AgentRunUsage['billingCalls']>[number][];
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number | null;
}

/** 将单次模型响应的用量累加到运行总量。 */
function addUsage(totals: Totals, usage: ModelUsage): void {
  if (usage.billingCalls) totals.billingCalls.push(...usage.billingCalls);
  else if (usage.billing) totals.billingCalls.push(usage.billing);
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  if (usage.estimatedCostMicros === null) totals.estimatedCostMicros = null;
  else if (totals.estimatedCostMicros !== null)
    totals.estimatedCostMicros += usage.estimatedCostMicros;
}

/** 将 Schema 错误压缩成可供模型修复提示使用的摘要。 */
function validationSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const location = issue.path.join('.') || '<root>';
      if (issue.code !== 'unrecognized_keys') return `${location}: ${issue.code}`;
      // 额外属性是结构问题；只传有界标识符，不把任意字段文本或输出值写入诊断。
      const names = issue.keys
        .slice(0, 8)
        .map((key) => (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(key) ? key : '<invalid-field-name>'));
      return `${location}: unrecognized_keys; remove unexpected fields [${names.join(', ')}]; keep only fields declared in outputContract.jsonSchema`;
    })
    .join('; ');
}

/** 1、先校验结构，2、再执行纯业务约束；仅预期校验错误进入纠正流程。 */
function validateOutput<TInput, TOutput>(
  definition: AgentDefinition<TInput, TOutput>,
  value: unknown,
  input: TInput,
): TOutput {
  const output = definition.outputSchema.parse(value);
  definition.validateOutput?.(output, input);
  return output;
}

/** 仅返回安全校验摘要，编程错误不伪装成模型输出错误。 */
function outputIssue(error: unknown): string {
  if (error instanceof z.ZodError) return validationSummary(error);
  if (error instanceof AgentRuntimeError && error.category === 'invalid_output')
    return sanitizeAgentErrorSummary(error.message);
  throw error;
}

/** AbortSignal 会跨 await 改变，取消检查不应让后续分支被收窄为恒假。 */
function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentRuntimeError('cancelled', 'Agent call was cancelled.');
}

/** 模型调用参数；execution 只记录归属，不自动开启结果复用。 */
interface AgentCall<TInput, TOutput> {
  readonly definition: AgentDefinition<TInput, TOutput>;
  readonly value: unknown;
  readonly signal: AbortSignal;
  readonly execution?: AgentExecution;
}
/** 普通调用只记录诊断；显式步骤调用才持久化恢复结果。 */
export class AgentRunner {
  readonly #store: AgentRunStore;
  readonly #model: ModelClient;
  readonly #createId: () => string;
  readonly #now: () => number;

  /** 执行模块组件对外暴露的操作。 */
  public constructor(input: {
    readonly store: AgentRunStore;
    readonly model: ModelClient;
    readonly createId: () => string;
    readonly now?: () => number;
  }) {
    this.#store = input.store;
    this.#model = input.model;
    this.#createId = input.createId;
    this.#now = input.now ?? Date.now;
  }

  /** 即时调用不保存输出正文，不恢复或共享其他执行的结果。 */
  public run<TInput, TOutput>(
    input: AgentCall<TInput, TOutput>,
  ): Promise<AgentRunnerResult<TOutput>> {
    return this.#run(input, false);
  }
  /** 同一任务步骤按完整输入身份恢复，禁止缺少执行归属的全局复用。 */
  public runStep<TInput, TOutput>(
    input: AgentCall<TInput, TOutput> & { execution: AgentExecution },
  ): Promise<AgentRunnerResult<TOutput>> {
    if (
      ['taskId', 'stepKey', 'resourceKey'].some((key) => {
        const value = input.execution[key as keyof AgentExecution];
        return typeof value !== 'string' || !value.trim();
      })
    )
      throw new TypeError('Agent step identity is required.');
    return this.#run(input, true);
  }
  async #run<TInput, TOutput>(
    input: AgentCall<TInput, TOutput>,
    recovery: boolean,
  ): Promise<AgentRunnerResult<TOutput>> {
    assertNotCancelled(input.signal);
    // 1、校验输入并计算完整执行身份；仅后台步骤允许恢复已成功的模型结果。
    const definition = input.definition;
    const parsedInput = definition.inputSchema.parse(input.value);
    const canonicalInput = canonicalJson(parsedInput);
    const estimatedInputTokens = Math.ceil(
      (definition.systemPrompt.length + canonicalInput.length) / 4,
    );
    if (estimatedInputTokens > definition.limits.maxInputTokens) {
      throw new AgentRuntimeError('budget_exceeded', 'Agent input token estimate exceeds budget.');
    }
    const inputHash = sha256(canonicalInput);
    const modelConfigHash = hashCanonical(this.#model.metadata);
    const definitionHash = agentDefinitionHash(definition);
    const reusableCacheKey = sha256(
      canonicalJson([
        definition.key,
        definitionHash,
        definition.outputSchemaVersion,
        modelConfigHash,
        inputHash,
        ...(recovery && input.execution
          ? [input.execution.taskId, input.execution.stepKey, input.execution.resourceKey]
          : [this.#createId()]),
      ]),
    );
    const cached = recovery ? this.#store.findSucceeded(reusableCacheKey) : null;
    // 已清除正文的终态记录仅用于诊断，不能占用恢复结果的成功唯一键。
    if (cached?.output === null) this.#store.invalidateSucceeded(cached.id);
    if (cached?.output !== null && cached?.output !== undefined) {
      try {
        return {
          run: cached,
          output: validateOutput(definition, cached.output, parsedInput),
          cacheHit: true,
        };
      } catch (error) {
        outputIssue(error);
        this.#store.invalidateSucceeded(cached.id);
      }
    }

    // 2、先登记 running 记录，再在事务外执行模型调用。
    const startedAt = this.#now();
    const previous = recovery ? this.#store.restartFailed(reusableCacheKey, startedAt) : null;
    const runId = previous?.id ?? this.#createId();
    logDiagnostic('info', 'agent.started', {
      agentRunId: runId,
      agentKey: definition.key,
      ...(input.execution
        ? { taskId: input.execution.taskId, stepKey: input.execution.stepKey }
        : {}),
    });
    // 普通调用使用单次运行键，不参与步骤恢复结果的成功唯一性竞争。
    const cacheKey = recovery ? reusableCacheKey : sha256(`${reusableCacheKey}|uncached|${runId}`);
    if (!previous)
      this.#store.createRunning({
        id: runId,
        ...(input.execution ? { execution: input.execution } : {}),
        agentKey: definition.key,
        definitionHash,
        modelConfigHash,
        inputHash,
        cacheKey,
        status: 'running',
        output: null,
        outputHash: null,
        errorCategory: null,
        errorSummary: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCostMicros: null,
        costCurrency: this.#model.metadata.costCurrency,
        pricingVersion: this.#model.metadata.pricingVersion,
        startedAt,
        finishedAt: null,
      });

    const timeout = AbortSignal.timeout(definition.limits.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeout]);
    const totals: Totals = {
      billingCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
    };
    // 3、执行 Agent 并将最终输出原子写入运行记录；并发竞争时使用胜者结果。
    try {
      const output = await this.#execute(definition, parsedInput, runId, signal, totals);
      const outputHash = sha256(canonicalJson(output));
      const completion = this.#store.completeSucceeded({
        id: runId,
        // 普通调用完成后仍保留独立身份，不向其他执行提供恢复结果。
        cacheKey: recovery ? cacheKey : sha256(`${cacheKey}|completed|${runId}`),
        output: recovery ? output : null,
        outputHash,
        usage: this.#usage(totals, previous),
        finishedAt: this.#now(),
      });
      logDiagnostic('info', 'agent.finished', {
        agentRunId: runId,
        agentKey: definition.key,
        durationMs: this.#now() - startedAt,
      });
      if (!recovery) {
        return { run: completion.record, output, cacheHit: false };
      }
      let winnerOutput: TOutput;
      try {
        winnerOutput = validateOutput(definition, completion.record.output, parsedInput);
      } catch (error) {
        const summary = outputIssue(error);
        this.#store.invalidateSucceeded(completion.record.id);
        throw new AgentRuntimeError('invalid_output', summary);
      }
      return { run: completion.record, output: winnerOutput, cacheHit: completion.kind === 'race' };
    } catch (error) {
      logDiagnostic('error', 'agent.failed', {
        agentRunId: runId,
        agentKey: definition.key,
        durationMs: this.#now() - startedAt,
        error,
      });
      // 4、将异常分类、脱敏并持久化，再把稳定错误交给上层重试策略。
      if (error instanceof ModelClientError && error.usage) addUsage(totals, error.usage);
      let classified = classifyAgentError(error);
      if (timeout.aborted && !input.signal.aborted) {
        classified = new AgentRuntimeError('timeout', 'Agent run exceeded its timeout.', true, {
          cause: error,
        });
      }
      const status = classified.category === 'cancelled' ? 'cancelled' : 'failed';
      try {
        if (this.#store.get(runId)?.status === 'running')
          this.#store.completeFailed({
            id: runId,
            status,
            category: classified.category,
            summary: sanitizeAgentErrorSummary(classified.message) || 'Agent run failed.',
            usage: this.#usage(totals, previous),
            finishedAt: this.#now(),
          });
      } catch (persistenceError) {
        logDiagnostic('error', 'agent.failure_record_failed', {
          agentRunId: runId,
          error: persistenceError,
        });
        classified = new AgentRuntimeError(
          classified.category,
          classified.message,
          classified.retryable,
          {
            cause: new AggregateError(
              [classified, persistenceError],
              'Agent execution and failure recording failed.',
            ),
          },
        );
      }
      throw classified;
    }
  }

  async #execute<TInput, TOutput>(
    definition: AgentDefinition<TInput, TOutput>,
    parsedInput: TInput,
    runId: string,
    signal: AbortSignal,
    totals: Totals,
  ): Promise<TOutput> {
    // 1、初始化工具注册表和输出 Schema，随后按步数上限进入模型循环。
    const tools = new ToolRegistry(definition.tools);
    const outputJsonSchema = z.toJSONSchema(definition.outputSchema, { unrepresentable: 'any' });
    const toolResults: ModelToolResult[] = [];
    const sequenceStart = this.#store.nextToolSequence(runId);
    let steps = 0;
    let response: ModelResponse;
    for (;;) {
      if (signal.aborted) throw new AgentRuntimeError('cancelled', 'Agent run was cancelled.');
      steps += 1;
      if (steps > definition.limits.maxSteps) {
        throw new AgentRuntimeError('budget_exceeded', 'Agent exceeded maximum steps.');
      }
      // 1、a 每轮模型调用都累计用量并立即执行预算检查。
      response = await this.#complete(
        {
          systemPrompt: definition.systemPrompt,
          input: parsedInput,
          outputSchemaName: definition.outputSchemaName,
          outputJsonSchema,
          ...(definition.limits.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: definition.limits.maxOutputTokens }),
          tools: definition.tools.map((tool) => ({ key: tool.key, description: tool.description })),
          toolResults,
        },
        signal,
        runId,
      );
      addUsage(totals, response.usage);
      this.#checkUsage(definition, totals);
      if (response.kind !== 'tool_calls') break;
      // 1、b 工具输入输出均在边界校验，成功调用才会加入下一轮上下文。
      for (const call of response.calls) {
        if (toolResults.length >= definition.limits.maxSteps) {
          throw new AgentRuntimeError('budget_exceeded', 'Agent exceeded maximum tool calls.');
        }
        const tool = tools.get(call.toolKey);
        if (!tool) throw new AgentRuntimeError('tool_error', `Unregistered tool: ${call.toolKey}.`);
        const toolInput = tool.inputSchema.parse(call.input);
        const toolStarted = this.#now();
        const sequenceNo = sequenceStart + toolResults.length;
        try {
          const output = tool.outputSchema.parse(await tool.execute(toolInput, { signal }));
          this.#store.saveToolCall({
            id: this.#createId(),
            agentRunId: runId,
            sequenceNo,
            toolKey: tool.key,
            inputSummary: tool.summarizeInput(toolInput),
            outputSummary: tool.summarizeOutput(output),
            status: 'succeeded',
            durationMs: Math.max(0, this.#now() - toolStarted),
            errorSummary: null,
          });
          toolResults.push({ callId: call.id, toolKey: tool.key, output });
        } catch (error) {
          // 1、先保留工具现场；2、失败审计写入异常不能替换原始故障。
          logDiagnostic('error', 'agent.tool_failed', {
            agentRunId: runId,
            toolKey: tool.key,
            sequenceNo,
            error,
          });
          let cause: unknown = error;
          try {
            this.#store.saveToolCall({
              id: this.#createId(),
              agentRunId: runId,
              sequenceNo,
              toolKey: tool.key,
              inputSummary: tool.summarizeInput(toolInput),
              outputSummary: null,
              status: 'failed',
              durationMs: Math.max(0, this.#now() - toolStarted),
              errorSummary:
                error instanceof Error
                  ? sanitizeAgentErrorSummary(error.message) || 'Tool failed.'
                  : 'Tool failed.',
            });
          } catch (persistenceError) {
            logDiagnostic('error', 'agent.tool_record_failed', {
              agentRunId: runId,
              toolKey: tool.key,
              sequenceNo,
              error: persistenceError,
            });
            cause = new AggregateError(
              [error, persistenceError],
              'Tool execution and failure recording failed.',
            );
          }
          throw new AgentRuntimeError('tool_error', `Tool ${tool.key} failed.`, false, { cause });
        }
      }
    }

    // 2、无效 JSON 与 Schema 不匹配共享同一个修复预算，原始正文只在内存中传回模型。
    let invalidOutput: unknown;
    let invalidSummary: string;
    if (response.kind === 'output') {
      invalidOutput = response.output;
      try {
        return validateOutput(definition, response.output, parsedInput);
      } catch (error) {
        invalidSummary = outputIssue(error);
      }
    } else {
      invalidOutput = response.text;
      invalidSummary = '<root>: invalid_json';
    }
    this.#recordOutputFailure(runId, response.usage, invalidSummary);
    steps += 1;
    if (steps > definition.limits.maxSteps) {
      throw new AgentRuntimeError('budget_exceeded', 'No step budget remains for output repair.');
    }
    const repaired = await this.#complete(
      {
        systemPrompt: definition.systemPrompt,
        input: parsedInput,
        outputSchemaName: definition.outputSchemaName,
        outputJsonSchema,
        ...(definition.limits.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: definition.limits.maxOutputTokens }),
        tools: [],
        toolResults: [],
        repair: {
          invalidOutput,
          validationSummary: invalidSummary,
        },
      },
      signal,
      runId,
    );
    addUsage(totals, repaired.usage);
    this.#checkUsage(definition, totals);
    if (repaired.kind === 'tool_calls') {
      this.#recordOutputFailure(runId, repaired.usage, '纠正响应不得请求工具。');
      throw new AgentRuntimeError('invalid_output', 'Repair response cannot request tools.');
    }
    if (repaired.kind === 'unparsed_output') {
      this.#recordOutputFailure(runId, repaired.usage, '纠正响应不是合法 JSON。');
      throw new AgentRuntimeError('invalid_output', 'Repair response was not JSON.');
    }
    try {
      return validateOutput(definition, repaired.output, parsedInput);
    } catch (error) {
      const summary = outputIssue(error);
      this.#recordOutputFailure(runId, repaired.usage, summary);
      throw new AgentRuntimeError('invalid_output', `Model output remains invalid: ${summary}`);
    }
  }

  /** 响应的输出校验结果归属最后一次实际请求，不虚构请求、不持久化原文。 */
  #recordOutputFailure(runId: string, usage: ModelUsage, summary: string): void {
    const billing = usage.billingCalls?.at(-1) ?? usage.billing;
    if (!billing?.requestId) return;
    this.#store.saveModelRequest(runId, {
      id: billing.requestId,
      state: 'completed',
      billing: {
        ...billing,
        failureReason: sanitizeAgentErrorSummary('输出校验未通过：' + summary),
      },
    });
  }

  /** 传输逐次通知即时落库；未实现观测的客户端仍在每轮返回/失败时保存明细。 */
  async #complete(
    request: ModelRequest,
    signal: AbortSignal,
    runId: string,
  ): Promise<ModelResponse> {
    const recordUsage = (usage: ModelUsage): ModelUsage => {
      const calls = (usage.billingCalls ?? (usage.billing ? [usage.billing] : [])).map((call) => ({
        ...call,
        requestId: call.requestId ?? randomUUID(),
      }));
      for (const billing of calls)
        this.#store.saveModelRequest(runId, { id: billing.requestId, state: 'completed', billing });
      const last = calls.at(-1);
      return { ...usage, billingCalls: calls, ...(last ? { billing: last } : {}) };
    };
    try {
      const response = await this.#model.complete(request, signal, {
        save: (record) => {
          this.#store.saveModelRequest(runId, record);
          logDiagnostic('debug', 'model.request', {
            agentRunId: runId,
            modelRequestId: record.id,
            state: record.state,
            statusCode: record.billing.statusCode,
            durationMs: record.billing.durationMs,
          });
        },
      });
      return { ...response, usage: recordUsage(response.usage) };
    } catch (error) {
      if (error instanceof ModelClientError && error.usage) error.usage = recordUsage(error.usage);
      throw error;
    }
  }

  #checkUsage<TInput, TOutput>(definition: AgentDefinition<TInput, TOutput>, totals: Totals): void {
    if (
      totals.inputTokens > definition.limits.maxInputTokens ||
      (definition.limits.maxOutputTokens !== undefined &&
        totals.outputTokens > definition.limits.maxOutputTokens) ||
      (totals.estimatedCostMicros !== null &&
        totals.estimatedCostMicros > definition.limits.maxEstimatedCostMicros)
    ) {
      throw new AgentRuntimeError('budget_exceeded', 'Agent model usage exceeded budget.');
    }
  }

  /**
   * 汇总运行级用量与成本。
   * 关键不变量：没有请求账单的运行（未发生模型调用，如刚启动即被取消）成本为真实
   * 的 0，价格版本记为 'no-calls'；'unpriced' 只表示存在已上报用量但缺价，避免
   * 展示层把真实的零成本遮挡成“未定价”。
   */
  #usage(totals: Totals, previous: AgentRunRecord | null): AgentRunUsage {
    const billingCalls = [...(previous?.billingCalls ?? []), ...totals.billingCalls];
    return {
      ...totals,
      billingCalls,
      inputTokens: (previous?.inputTokens ?? 0) + totals.inputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + totals.outputTokens,
      estimatedCostMicros:
        totals.estimatedCostMicros === null ||
        (previous !== null && previous.estimatedCostMicros === null)
          ? null
          : (previous?.estimatedCostMicros ?? 0) + totals.estimatedCostMicros,
      costCurrency: this.#model.metadata.costCurrency,
      pricingVersion: billingCalls.length
        ? [...new Set(billingCalls.map((call) => call.pricingVersion))].join(',')
        : (previous?.pricingVersion ?? 'no-calls'),
    };
  }
}
