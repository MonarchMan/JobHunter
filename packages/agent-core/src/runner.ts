import { z } from 'zod';
import { canonicalJson, hashCanonical, sha256 } from './canonical.js';
import type { AgentDefinition } from './definition.js';
import { AgentRuntimeError, classifyAgentError, sanitizeAgentErrorSummary } from './errors.js';
import type { ModelClient, ModelResponse, ModelToolResult, ModelUsage } from './model-client.js';
import type { AgentRunRecord, AgentRunStore, AgentRunUsage } from './store.js';
import { ToolRegistry } from './tools.js';

/** 模块数据结构或契约。 */
export interface AgentRunnerResult<TOutput> {
  readonly run: AgentRunRecord;
  readonly output: TOutput;
  readonly cacheHit: boolean;
}

/** 模块数据结构或契约。 */
interface Totals {
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: number;
}

/** 将单次模型响应的用量累加到运行总量。 */
function addUsage(totals: Totals, usage: ModelUsage): void {
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.estimatedCostMicros += usage.estimatedCostMicros;
}

/** 将 Schema 错误压缩成可供模型修复提示使用的摘要。 */
function validationSummary(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.code}`)
    .join('; ');
}

/** 执行版本化 Agent，负责校验、缓存、工具循环、用量限制和结果持久化。 */
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

  public async run<TInput, TOutput>(input: {
    readonly definition: AgentDefinition<TInput, TOutput>;
    readonly value: unknown;
    readonly signal: AbortSignal;
  }): Promise<AgentRunnerResult<TOutput>> {
    // 1、校验输入并计算包含模型配置的缓存键；命中成功缓存时不重复调用模型。
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
    const cacheKey = sha256(
      [
        definition.key,
        definition.version,
        definition.promptVersion,
        definition.outputSchemaVersion,
        modelConfigHash,
        inputHash,
      ].join('|'),
    );
    const cached = this.#store.findSucceeded(cacheKey);
    if (cached?.output !== null && cached?.output !== undefined) {
      return { run: cached, output: definition.outputSchema.parse(cached.output), cacheHit: true };
    }

    // 2、先登记 running 记录，再在事务外执行模型调用。
    const startedAt = this.#now();
    const runId = this.#createId();
    this.#store.createRunning({
      id: runId,
      agentKey: definition.key,
      agentVersion: definition.version,
      promptVersion: definition.promptVersion,
      modelConfigHash,
      inputHash,
      cacheKey,
      status: 'running',
      output: null,
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
    const totals: Totals = { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 };
    // 3、执行 Agent 并将最终输出原子写入运行记录；并发竞争时使用胜者结果。
    try {
      const output = await this.#execute(definition, parsedInput, runId, signal, totals);
      const completion = this.#store.completeSucceeded({
        id: runId,
        cacheKey,
        output,
        usage: this.#usage(totals),
        finishedAt: this.#now(),
      });
      const winnerOutput = definition.outputSchema.parse(completion.record.output);
      return { run: completion.record, output: winnerOutput, cacheHit: completion.kind === 'race' };
    } catch (error) {
      // 4、将异常分类、脱敏并持久化，再把稳定错误交给上层重试策略。
      let classified = classifyAgentError(error);
      if (timeout.aborted && !input.signal.aborted) {
        classified = new AgentRuntimeError('timeout', 'Agent run exceeded its timeout.', true);
      }
      const status = classified.category === 'cancelled' ? 'cancelled' : 'failed';
      this.#store.completeFailed({
        id: runId,
        status,
        category: classified.category,
        summary: sanitizeAgentErrorSummary(classified.message) || 'Agent run failed.',
        usage: this.#usage(totals),
        finishedAt: this.#now(),
      });
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
    let steps = 0;
    let response: ModelResponse;
    for (;;) {
      if (signal.aborted) throw new AgentRuntimeError('cancelled', 'Agent run was cancelled.');
      steps += 1;
      if (steps > definition.limits.maxSteps) {
        throw new AgentRuntimeError('budget_exceeded', 'Agent exceeded maximum steps.');
      }
      // 1、a 每轮模型调用都累计用量并立即执行预算检查。
      response = await this.#model.complete(
        {
          systemPrompt: definition.systemPrompt,
          input: parsedInput,
          outputSchemaName: definition.outputSchemaName,
          outputJsonSchema,
          maxOutputTokens: definition.limits.maxOutputTokens,
          tools: definition.tools.map((tool) => ({ key: tool.key, description: tool.description })),
          toolResults,
        },
        signal,
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
        const sequenceNo = toolResults.length;
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
          throw new AgentRuntimeError('tool_error', `Tool ${tool.key} failed.`);
        }
      }
    }

    // 2、无效 JSON 与 Schema 不匹配共享同一个修复预算，原始正文只在内存中传回模型。
    let invalidOutput: unknown;
    let invalidSummary: string;
    if (response.kind === 'output') {
      const initial = definition.outputSchema.safeParse(response.output);
      if (initial.success) return initial.data;
      invalidOutput = response.output;
      invalidSummary = validationSummary(initial.error);
    } else {
      invalidOutput = response.text;
      invalidSummary = '<root>: invalid_json';
    }
    steps += 1;
    if (steps > definition.limits.maxSteps) {
      throw new AgentRuntimeError('budget_exceeded', 'No step budget remains for output repair.');
    }
    const repaired = await this.#model.complete(
      {
        systemPrompt: definition.systemPrompt,
        input: parsedInput,
        outputSchemaName: definition.outputSchemaName,
        outputJsonSchema,
        maxOutputTokens: definition.limits.maxOutputTokens,
        tools: [],
        toolResults: [],
        repair: {
          invalidOutput,
          validationSummary: invalidSummary,
        },
      },
      signal,
    );
    addUsage(totals, repaired.usage);
    this.#checkUsage(definition, totals);
    if (repaired.kind === 'tool_calls') {
      throw new AgentRuntimeError('invalid_output', 'Repair response cannot request tools.');
    }
    if (repaired.kind === 'unparsed_output')
      throw new AgentRuntimeError('invalid_output', 'Repair response was not JSON.');
    const result = definition.outputSchema.safeParse(repaired.output);
    if (!result.success)
      throw new AgentRuntimeError('invalid_output', 'Model output remains invalid.');
    return result.data;
  }

  #checkUsage<TInput, TOutput>(definition: AgentDefinition<TInput, TOutput>, totals: Totals): void {
    if (
      totals.inputTokens > definition.limits.maxInputTokens ||
      totals.outputTokens > definition.limits.maxOutputTokens ||
      totals.estimatedCostMicros > definition.limits.maxEstimatedCostMicros
    ) {
      throw new AgentRuntimeError('budget_exceeded', 'Agent model usage exceeded budget.');
    }
  }

  /** 处理模块类内部的辅助逻辑。 */
  #usage(totals: Totals): AgentRunUsage {
    return {
      ...totals,
      costCurrency: this.#model.metadata.costCurrency,
      pricingVersion: this.#model.metadata.pricingVersion,
    };
  }
}
