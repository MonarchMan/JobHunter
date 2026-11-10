import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  sanitizeAgentErrorSummary,
  ModelClientError,
  ModelRequestPersistenceError,
} from '../agent/errors.js';
import type { ModelUsage, ModelRequestObserver } from '../agent/model-client.js';
import type { ModelBilling } from '../contracts/model-usage.js';

/** SSE 事件只接受对象；供应商字段仍由各自客户端完成最终边界校验。 */
const object = z.record(z.string(), z.unknown());

/** 累计快照按分项覆盖而非相加，空值不抹掉已上报的输入或缓存等计数。 */
function mergeReportedUsage(previous: unknown, next: unknown, depth = 0): Record<string, unknown> {
  const result = { ...(object.safeParse(previous).data ?? {}) };
  for (const [key, value] of Object.entries(object.parse(next))) {
    if (value == null) continue;
    result[key] =
      depth < 1 && typeof value === 'object' && !Array.isArray(value)
        ? mergeReportedUsage(result[key], value, depth + 1)
        : value;
  }
  return result;
}

/** 计量快照交由协议适配器校验和定价；传输层不解释供应商 Token 字段。 */
type CaptureUsage = (
  usage: unknown,
  context: {
    readonly requestedAt: number;
    readonly headers: Headers;
    readonly serviceTier: unknown;
  },
) => ModelBilling;
const openAiChunk = z.object({
  model: z.string().optional(),
  usage: z.unknown().optional(),
  service_tier: z.unknown().optional(),
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        finish_reason: z.string().nullable().optional(),
        delta: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().nonnegative(),
                id: z.string().optional(),
                function: z
                  .object({ name: z.string().optional(), arguments: z.string().optional() })
                  .optional(),
              }),
            )
            .optional(),
        }),
      }),
    )
    .optional(),
});

/** 有界流聚合器：保留原文本/工具协议，首字仅在真实内容出现时触发。 */
async function readStream(
  response: Response,
  protocol: 'openai' | 'anthropic',
  first: () => void,
  capture: (usage: unknown, serviceTier: unknown) => void,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ModelClientError('invalid_output', 'Model stream has no body.');
  const decoder = new TextDecoder();
  let buffer = '',
    text = '',
    finish: string | null = null,
    bytes = 0;
  const state = { terminal: false };
  let usage: unknown, model: string | undefined, tier: unknown;
  const tools = new Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >();
  const blocks = new Map<number, Record<string, unknown>>();
  const toolJson = new Map<number, string>();
  let anthropicUsage: Record<string, unknown> = {};
  /** 处理完整事件，不把 role、空增量或心跳作为首字。 */
  const event = (frame: string): void => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const raw: unknown = JSON.parse(data);
    if (protocol === 'openai') {
      const chunk = openAiChunk.parse(raw);
      if (object.parse(raw).error)
        throw new ModelClientError('temporary', 'Model stream returned an error.', true);
      model = chunk.model ?? model;
      tier = chunk.service_tier ?? tier;
      if (chunk.usage != null) {
        usage = mergeReportedUsage(usage, chunk.usage);
        capture(usage, tier);
      }
      for (const choice of chunk.choices ?? []) {
        if ((choice.index ?? 0) !== 0) continue;
        if (choice.finish_reason) {
          finish = choice.finish_reason;
          state.terminal = true;
        }
        const delta = choice.delta;
        if (delta.content || delta.reasoning_content || delta.refusal) first();
        text += delta.content ?? '';
        if (delta.refusal) finish = 'content_filter';
        for (const fragment of delta.tool_calls ?? []) {
          const tool = tools.get(fragment.index) ?? {
            id: '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          tool.id += fragment.id ?? '';
          tool.function.name += fragment.function?.name ?? '';
          tool.function.arguments += fragment.function?.arguments ?? '';
          if (fragment.function?.name || fragment.function?.arguments) first();
          tools.set(fragment.index, tool);
        }
      }
      return;
    }
    const value = object.parse(raw);
    const type = z.string().parse(value.type);
    if (type === 'error')
      throw new ModelClientError('temporary', 'Model stream returned an error.', true);
    if (type === 'message_start') {
      const message = object.parse(value.message);
      if (message.usage != null) {
        anthropicUsage = mergeReportedUsage(anthropicUsage, message.usage);
        capture(anthropicUsage, undefined);
      }
    } else if (type === 'content_block_start') {
      const index = z.number().int().nonnegative().parse(value.index);
      const block = object.parse(value.content_block);
      blocks.set(index, { ...block });
      if (typeof block.text === 'string' && block.text) first();
    } else if (type === 'content_block_delta') {
      const index = z.number().int().nonnegative().parse(value.index);
      const block = blocks.get(index);
      if (!block) throw new ModelClientError('invalid_output', 'Model stream block is missing.');
      const delta = object.parse(value.delta);
      if (delta.type === 'text_delta') {
        const part = z.string().parse(delta.text);
        if (part) first();
        block.text = z.string().parse(block.text ?? '') + part;
      } else if (delta.type === 'input_json_delta') {
        const part = z.string().parse(delta.partial_json);
        if (part) first();
        toolJson.set(index, (toolJson.get(index) ?? '') + part);
      } else if (delta.type === 'thinking_delta' && delta.thinking) first();
    } else if (type === 'message_delta') {
      const delta = object.parse(value.delta);
      finish = z.string().nullable().optional().parse(delta.stop_reason) ?? finish;
      if (value.usage != null) {
        anthropicUsage = mergeReportedUsage(anthropicUsage, value.usage);
        capture(anthropicUsage, undefined);
      }
    } else if (type === 'message_stop') state.terminal = true;
  };
  try {
    // 1、逐块解码 UTF-8，支持跨网络分片事件；限制单次完整响应为 16 MiB。
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16 * 1024 * 1024)
        throw new ModelClientError('invalid_output', 'Model stream exceeded the response limit.');
      buffer += decoder.decode(part.value, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        event(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) event(buffer);
    // 2、网络正常 EOF 不能替代协议终止事件，禁止将截断 JSON 当成成功。
    if (!state.terminal)
      throw new ModelClientError('invalid_output', 'Model stream ended before completion.');
    if (protocol === 'openai')
      return {
        model,
        service_tier: tier,
        usage,
        choices: [
          {
            finish_reason: finish,
            message: { content: text, ...(tools.size ? { tool_calls: [...tools.values()] } : {}) },
          },
        ],
      };
    for (const [index, json] of toolJson) {
      const block = blocks.get(index);
      if (block) block.input = JSON.parse(json) as unknown;
    }
    return {
      content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
      usage: anthropicUsage,
      stop_reason: finish,
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * 单次实际 HTTP 请求快照；不保留完整 URL、Headers 或响应正文。
 * billing 在收到有效用量后即可设置，流中断仍保留部分账单；未上报用量的失败请求（网络错误、
 * 400 协商拒绝、超时取消）保持缺省，聚合时以 billing 是否为 undefined 区分
 * “未上报用量”（对运行合计按 0 计入）与“已上报但缺价”（使合计未知）。
 */
interface Attempt {
  id: string;
  completed: boolean;
  at: number;
  ended: number;
  first: number | null;
  status: number | null;
  error: ModelBilling['transportError'];
  failureReason?: string;
  billing?: ModelBilling;
}

/** 每个 complete 独立观测所有协商尝试，避免多请求合并和失败漏账。 */
export class ModelRequestTrace {
  readonly #attempts: Attempt[] = [];
  public constructor(
    private readonly config: { baseUrl: string; model: string; costCurrency: 'USD' | 'CNY' },
    private readonly now: () => number = Date.now,
    private readonly observer?: ModelRequestObserver,
  ) {}
  public get requestedAt(): number {
    return this.#attempts.at(-1)?.at ?? this.now();
  }

  /** 请求流式响应；明确不支持 stream 的 400 仅回退一次普通 JSON，并分别记录。 */
  public async fetch(
    fetcher: typeof fetch,
    url: string,
    init: RequestInit,
    protocol: 'openai' | 'anthropic',
    captureUsage?: CaptureUsage,
  ): Promise<Response> {
    const body = object.parse(JSON.parse(z.string().parse(init.body)));
    const send = async (stream: boolean): Promise<Response> => {
      const attempt: Attempt = {
        id: randomUUID(),
        completed: false,
        at: this.now(),
        ended: this.now(),
        first: null,
        status: null,
        error: null,
      };
      this.#attempts.push(attempt);
      this.#publish(attempt);
      try {
        const response = await fetcher(url, {
          ...init,
          body: JSON.stringify({
            ...body,
            ...(stream
              ? {
                  stream: true,
                  ...(protocol === 'openai' ? { stream_options: { include_usage: true } } : {}),
                }
              : {}),
          }),
        });
        attempt.status = response.status;
        if (!response.ok) {
          attempt.ended = this.now();
          attempt.completed = true;
          this.#publish(attempt);
          return response;
        }
        const streaming = response.headers.get('content-type')?.includes('text/event-stream');
        // 1、每份有效计量先落账本，后续中断只能改变请求状态，不能清空已知分项。
        const capture = (usage: unknown, serviceTier: unknown): void => {
          const billing = captureUsage?.(usage, {
            requestedAt: attempt.at,
            headers: response.headers,
            serviceTier,
          });
          if (
            !billing ||
            [
              billing.inputTokens,
              billing.outputTokens,
              billing.cacheReadTokens,
              billing.cacheWriteTokens,
            ].every((value) => value === null)
          )
            return;
          attempt.billing = billing;
          this.#publish(attempt);
        };
        const payload: unknown = streaming
          ? await readStream(
              response,
              protocol,
              () => {
                attempt.first ??= this.now();
              },
              capture,
            )
          : await response.json();
        if (!streaming) {
          const envelope = object.safeParse(payload);
          if (envelope.success && envelope.data.usage != null)
            capture(envelope.data.usage, envelope.data.service_tier);
        }
        attempt.ended = this.now();
        attempt.completed = true;
        return new Response(JSON.stringify(payload), {
          status: response.status,
          headers: {
            'content-type': 'application/json',
            ...Object.fromEntries(
              [...response.headers].filter(
                ([name]) => !['content-type', 'content-length', 'content-encoding'].includes(name),
              ),
            ),
          },
        });
      } catch (error) {
        if (error instanceof ModelRequestPersistenceError) throw error;
        attempt.ended = this.now();
        attempt.completed = true;
        attempt.error = init.signal?.aborted
          ? 'cancelled'
          : error instanceof ModelClientError ||
              error instanceof z.ZodError ||
              error instanceof SyntaxError
            ? 'invalid_output'
            : 'network';
        if (error instanceof SyntaxError)
          throw new ModelClientError(
            'invalid_output',
            'Model provider returned invalid JSON.',
            false,
            { cause: error },
          );
        throw error;
      }
    };
    const response = await send(true);
    if (response.status === 400) {
      const text = await response.text();
      if (
        /stream/i.test(text) &&
        /unsupported|not.support|unknown|unrecognized|not.allowed/i.test(text)
      ) {
        this.noteFailure('接口不支持流式请求，已改用非流式请求重试。');
        return send(false);
      }
      return new Response(text, { status: response.status, headers: response.headers });
    }
    return response;
  }

  /** 记录已确认的协商失败，原因写入该次请求而非后续成功请求。 */
  public noteFailure(reason: string): void {
    const last = this.#attempts.at(-1);
    if (!last) return;
    last.failureReason = sanitizeAgentErrorSummary(reason);
    this.#publish(last);
  }

  /** 有效用量到达即可拥有账单，失败收尾沿用已保存快照，协商失败保持未知。 */
  public usage(billing?: ModelBilling): ModelUsage {
    const last = this.#attempts.at(-1);
    if (billing && last) last.billing = billing;
    const calls = this.#attempts.map((attempt) => {
      const base: ModelBilling = attempt.billing ?? {
        model: this.config.model,
        requestedAt: attempt.at,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        uncachedInputTokens: null,
        inputCostMicros: null,
        outputCostMicros: null,
        cacheReadCostMicros: null,
        cacheWriteCostMicros: null,
        totalCostMicros: null,
        currency: this.config.costCurrency,
        pricingVersion: 'unpriced',
        period: 'unknown',
        precision: 'unpriced',
        rates: null,
      };
      const generationMs = attempt.first === null ? 0 : attempt.ended - attempt.first;
      return {
        ...base,
        requestId: attempt.id,
        requestedAt: attempt.at,
        application: 'JobHunter',
        provider: new URL(this.config.baseUrl).host,
        statusCode: attempt.status,
        durationMs: attempt.completed ? Math.max(0, attempt.ended - attempt.at) : null,
        firstTokenMs: attempt.first === null ? null : Math.max(0, attempt.first - attempt.at),
        outputTokensPerSecond:
          generationMs > 0 && base.outputTokens !== null
            ? (base.outputTokens * 1000) / generationMs
            : null,
        transportError: attempt.error,
        ...(attempt.failureReason ? { failureReason: attempt.failureReason } : {}),
      };
    });
    const latest = calls.at(-1);
    if (billing && last) this.#publish(last, latest);
    return {
      billingCalls: calls,
      ...(latest ? { billing: latest } : {}),
      inputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      // 只有已解析账单但缺价的请求才使合计未知；未上报用量的失败请求没有已知
      // 成本，对运行合计按 0 计入，不得把其他请求的真实成本一起标成“未定价”。
      estimatedCostMicros: this.#attempts.some(
        (attempt) => attempt.billing?.totalCostMicros === null,
      )
        ? null
        : calls.reduce((n, c) => n + (c.totalCostMicros ?? 0), 0),
    };
  }
  /** 将失败请求账本交给 Runner；原有错误分类与脱敏摘要保持不变。 */
  public failure(error: unknown): never {
    if (error instanceof ModelClientError) {
      const last = this.#attempts.at(-1);
      if (last && (error.category === 'timeout' || error.category === 'cancelled'))
        last.error = error.category;
      if (last && error.category === 'invalid_output') last.error = 'invalid_output';
      if (last) last.failureReason ??= sanitizeAgentErrorSummary(error.message);
      error.usage = this.usage();
      if (last) {
        try {
          this.#publish(last, error.usage.billing);
        } catch (persistenceError) {
          if (!(persistenceError instanceof ModelRequestPersistenceError)) throw persistenceError;
          // 收尾写入失败仍禁止重发，但必须保留此前调用失败的完整诊断。
          throw new ModelRequestPersistenceError(
            persistenceError.requestId,
            persistenceError.phase,
            {
              cause: new AggregateError(
                [error, persistenceError],
                'Model request and ledger recording failed.',
              ),
            },
          );
        }
      }
    }
    throw error;
  }

  /** 开始、协商失败、成功解析及异常结束共享同一请求身份。 */
  #publish(attempt: Attempt, billing?: ModelBilling): void {
    if (!this.observer) return;
    const snapshot =
      billing ?? this.usage().billingCalls?.find((call) => call.requestId === attempt.id);
    if (snapshot) {
      try {
        this.observer.save({
          id: attempt.id,
          state: attempt.completed ? 'completed' : 'running',
          billing: snapshot,
        });
      } catch (error) {
        throw new ModelRequestPersistenceError(
          attempt.id,
          attempt.completed ? 'completed' : 'running',
          { cause: error },
        );
      }
    }
  }
}
