import type { ModelBilling } from '../contracts/model-usage.js';
import { calculateBilling } from './billing.js';
import { resolveModelPricing } from '../config/model-pricing.js';
import { ModelRequestTrace } from './request-trace.js';
import {
  cacheCreationSchema,
  cacheWriteTotal,
  inputTokenDetailsSchema,
  kimiCacheDurations,
  optionalTokenCount,
} from './cache-usage.js';
import {
  ModelClientError,
  type ModelClient,
  type ModelRequest,
  type ModelRequestObserver,
  ModelRequestPersistenceError,
  type ModelResponse,
  type ModelUsage,
} from '@jobhunter/common/agent';
import { networkReason } from './network-error.js';
import { z } from 'zod';

const configSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .refine((value) => {
        try {
          return ['http:', 'https:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, 'Base URL must be an HTTP(S) URL.'),
    apiKey: z.string().trim().min(1),
    model: z.string().trim().min(1),
    costCurrency: z.enum(['USD', 'CNY']).default('USD'),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60_000)
      .default(180_000),
    cacheReadPrice: z.number().nonnegative().nullable().optional(),
    cacheWritePrice: z.number().nonnegative().nullable().optional(),
    cacheWrite1hPrice: z.number().nonnegative().nullable().optional(),
    inputCostPerMillionUsd: z.number().nonnegative().nullable().optional(),
    outputCostPerMillionUsd: z.number().nonnegative().nullable().optional(),
  })
  .strict();

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                function: z.object({ name: z.string().min(1), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  service_tier: z.string().nullable().optional(),
  usage: z
    .object({
      prompt_cache_hit_tokens: z.number().int().nonnegative().nullable().optional(),
      prompt_cache_miss_tokens: z.number().int().nonnegative().nullable().optional(),
      prompt_tokens_details: inputTokenDetailsSchema,
      input_tokens_details: inputTokenDetailsSchema,
      cache_read_input_tokens: optionalTokenCount,
      cache_creation_input_tokens: optionalTokenCount,
      cache_creation: cacheCreationSchema,
      completion_tokens_details: z
        .object({ reasoning_tokens: optionalTokenCount })
        .nullable()
        .optional(),
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

/** 模块数据结构或契约。 */
export interface OpenAiCompatibleClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly costCurrency?: 'USD' | 'CNY';
  readonly timeoutMs?: number;
  readonly inputCostPerMillionUsd?: number | null | undefined;
  readonly outputCostPerMillionUsd?: number | null | undefined;
  readonly fetchImplementation?: typeof fetch;
  readonly cacheReadPrice?: number | null | undefined;
  readonly cacheWritePrice?: number | null | undefined;
  readonly cacheWrite1hPrice?: number | null | undefined;
  readonly now?: () => number;
}

/** 将基础地址规范化为 chat/completions 端点。 */
function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/u, '');
  if (path.endsWith('/chat/completions')) return url.toString();
  url.pathname = `${path || '/v1'}/chat/completions`;
  return url.toString();
}

/** 将供应商 usage 字段转换为统一模型用量。 */
function usage(value: z.infer<typeof responseSchema>['usage']): ModelUsage {
  return {
    inputTokens: value?.prompt_tokens ?? 0,
    outputTokens: value?.completion_tokens ?? 0,
    estimatedCostMicros: null,
  };
}

/** 判断是否连接 DeepSeek 官方 OpenAI 兼容入口。 */
function isDeepSeekApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.deepseek.com';
  } catch {
    return false;
  }
}

/** 结构化输出协商格式：json_schema、JSON mode 或无格式参数。 */
type StructuredFormat = 'json_schema' | 'json_object' | 'none';

/** 将协商格式映射为供应商 response_format 载荷。 */
function responseFormatPayload(
  format: Exclude<StructuredFormat, 'none'>,
  request: ModelRequest,
): Record<string, unknown> {
  return format === 'json_object'
    ? { type: 'json_object' }
    : {
        type: 'json_schema',
        json_schema: {
          name: request.outputSchemaName,
          strict: true,
          schema: request.outputJsonSchema,
        },
      };
}

/** DeepSeek v4 的结构化任务关闭默认思考模式，避免正文生成延迟。 */
function shouldDisableDeepSeekThinking(baseUrl: string, model: string): boolean {
  return isDeepSeekApi(baseUrl) && model.startsWith('deepseek-v4');
}

/** 严格解析 JSON，并仅兼容包裹整个响应的单层 Markdown JSON 代码围栏。 */
function parseStructuredContent(
  content: string,
): { readonly parsed: true; readonly value: unknown } | { readonly parsed: false } {
  const trimmed = content.trim();
  if (!trimmed) return { parsed: false };
  try {
    return { parsed: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
    if (!fenced?.[1]) return { parsed: false };
    try {
      return { parsed: true, value: JSON.parse(fenced[1].trim()) as unknown };
    } catch {
      return { parsed: false };
    }
  }
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
async function responseError(response: Response): Promise<ModelClientError> {
  const status = response.status;
  if (status === 401 || status === 403)
    return new ModelClientError('invalid_auth', 'Model provider rejected authentication.');
  if (status === 429)
    return new ModelClientError('rate_limited', 'Model provider rate limited the request.', true);
  if (status >= 500)
    return new ModelClientError('temporary', 'Model provider is temporarily unavailable.', true);
  let detail = '';
  try {
    const body = z
      .object({
        error: z.object({
          code: z.union([z.string(), z.number()]).optional(),
          param: z.string().optional(),
        }),
      })
      .safeParse(await response.json());
    if (body.success) {
      const code = body.data.error.code;
      const param = body.data.error.param;
      const safeCode = code === undefined ? '' : String(code).replaceAll(/[^a-zA-Z0-9_.-]/g, '');
      const safeParam = param?.replaceAll(/[^a-zA-Z0-9_.-]/g, '') ?? '';
      detail = [safeCode && `code=${safeCode}`, safeParam && `param=${safeParam}`]
        .filter(Boolean)
        .join(',');
    }
  } catch {
    // Upstream error bodies are optional and never included verbatim.
  }
  return new ModelClientError(
    'invalid_request',
    `Model provider rejected the request (${String(status)}${detail ? `; ${detail}` : ''}).`,
  );
}

/** OpenAI-compatible Chat Completions adapter. Provider DTOs stay inside this boundary. */
/** 调用 OpenAI 协议兼容接口并校验响应结构。 */
export class OpenAiCompatibleModelClient implements ModelClient {
  readonly #config: z.infer<typeof configSchema>;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  /** 已协商成功的结构化格式；首次 400 探测后整个客户端生命周期直接复用，不再逐请求重探。 */
  #negotiatedFormat: StructuredFormat | null = null;

  public readonly metadata: ModelClient['metadata'];

  /** 执行模块组件对外暴露的操作。 */
  public constructor(input: OpenAiCompatibleClientConfig) {
    this.#config = configSchema.parse({
      cacheReadPrice: input.cacheReadPrice,
      cacheWritePrice: input.cacheWritePrice,
      cacheWrite1hPrice: input.cacheWrite1hPrice,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      costCurrency: input.costCurrency ?? 'USD',
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      inputCostPerMillionUsd: input.inputCostPerMillionUsd,
      outputCostPerMillionUsd: input.outputCostPerMillionUsd,
    });
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#now = input.now ?? Date.now;
    this.metadata = {
      provider: 'openai-compatible',
      model: this.#config.model,
      config: { baseUrl: this.#config.baseUrl, timeoutMs: this.#config.timeoutMs },
      costCurrency: this.#config.costCurrency,
      pricingVersion:
        this.#config.inputCostPerMillionUsd == null || this.#config.outputCostPerMillionUsd == null
          ? 'unpriced'
          : 'configured',
    };
  }

  /** 发送一次模型请求并映射文本、工具调用和用量。 */
  public async complete(
    request: ModelRequest,
    signal: AbortSignal,
    observer?: ModelRequestObserver,
  ): Promise<ModelResponse> {
    const trace = new ModelRequestTrace(this.#config, this.#now, observer);
    try {
      return await this.#complete(request, signal, trace);
    } catch (error) {
      return trace.failure(error);
    }
  }

  /** 正常响应与中断快照共用协议归一化和计价，缺失分项保持未知。 */
  #billing(
    value: unknown,
    requestedAt: number,
    headers: Headers,
    serviceTier: unknown,
  ): ModelBilling {
    // 1、优先采用官方缓存字段；显式零必须保留，缺失才回退兼容字段。
    const raw = responseSchema.shape.usage.parse(value);
    const headerDurations = kimiCacheDurations(this.#config.baseUrl, headers);
    const durations = {
      ephemeral_5m_input_tokens:
        headerDurations?.ephemeral_5m_input_tokens ??
        raw?.cache_creation?.ephemeral_5m_input_tokens ??
        null,
      ephemeral_1h_input_tokens:
        headerDurations?.ephemeral_1h_input_tokens ??
        raw?.cache_creation?.ephemeral_1h_input_tokens ??
        null,
    };
    const read = isDeepSeekApi(this.#config.baseUrl)
      ? (raw?.prompt_cache_hit_tokens ?? raw?.prompt_tokens_details?.cached_tokens ?? null)
      : (raw?.cache_read_input_tokens ??
        raw?.input_tokens_details?.cached_tokens ??
        raw?.prompt_tokens_details?.cached_tokens ??
        raw?.prompt_cache_hit_tokens ??
        null);
    const write = cacheWriteTotal(
      raw?.cache_creation_input_tokens ??
        raw?.input_tokens_details?.cache_write_tokens ??
        raw?.prompt_tokens_details?.cache_write_tokens,
      durations,
    );
    const inputTokens = raw?.prompt_tokens ?? null;
    const miss =
      raw?.prompt_cache_miss_tokens ??
      (inputTokens !== null && read !== null ? inputTokens - read - (write ?? 0) : null);
    const usage = {
      model: this.#config.model,
      baseUrl: this.#config.baseUrl,
      requestedAt,
      currency: this.#config.costCurrency,
      inputTokens,
      outputTokens: raw?.completion_tokens ?? null,
      cacheReadTokens: read,
      cacheWriteTokens: write,
      cacheWrite5mTokens: durations.ephemeral_5m_input_tokens,
      cacheWrite1hTokens: durations.ephemeral_1h_input_tokens,
      serviceTier: z.string().nullable().optional().parse(serviceTier),
      thinking:
        raw?.completion_tokens_details?.reasoning_tokens == null
          ? null
          : raw.completion_tokens_details.reasoning_tokens > 0,
      uncachedInputTokens: miss,
    };
    const quote = resolveModelPricing({
      ...usage,
      inputPrice: this.#config.inputCostPerMillionUsd,
      outputPrice: this.#config.outputCostPerMillionUsd,
      cacheReadPrice: this.#config.cacheReadPrice,
      cacheWritePrice: this.#config.cacheWritePrice,
      cacheWrite1hPrice: this.#config.cacheWrite1hPrice,
    });
    return calculateBilling(usage, quote);
  }

  /** 保持原响应校验与格式协商，HTTP 传输交给逐请求观测器。 */
  async #complete(
    request: ModelRequest,
    signal: AbortSignal,
    trace: ModelRequestTrace,
  ): Promise<ModelResponse> {
    const timeout = AbortSignal.timeout(this.#config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const messages = [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          input: request.input,
          outputContract: {
            name: request.outputSchemaName,
            jsonSchema: request.outputJsonSchema,
          },
          ...(request.toolResults.length === 0 ? {} : { toolResults: request.toolResults }),
          ...(request.repair ? { repair: request.repair } : {}),
        }),
      },
    ];
    try {
      const baseBody = {
        model: this.#config.model,
        messages,
        ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
        ...(shouldDisableDeepSeekThinking(this.#config.baseUrl, this.#config.model)
          ? { thinking: { type: 'disabled' as const } }
          : {}),
        ...(request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.key,
                  description: tool.description,
                  parameters: { type: 'object', additionalProperties: true },
                },
              })),
            }),
      };
      const dispatch = (responseFormat?: unknown): Promise<Response> =>
        trace.fetch(
          this.#fetch,
          endpoint(this.#config.baseUrl),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.#config.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              ...baseBody,
              ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
            }),
            signal: combined,
          },
          'openai',
          (value, context) =>
            this.#billing(value, context.requestedAt, context.headers, context.serviceTier),
        );
      const deepSeek = isDeepSeekApi(this.#config.baseUrl);
      // 1、协商成功的格式直接复用；未协商时 DeepSeek 直接 json_object，其余网关优先 json_schema。
      let format: StructuredFormat = deepSeek
        ? 'json_object'
        : (this.#negotiatedFormat ?? 'json_schema');
      if (format === 'none' && this.#negotiatedFormat === null) format = 'json_schema';
      let response = await dispatch(
        format === 'none' ? undefined : responseFormatPayload(format, request),
      );
      // 1.a、仅在客户端尚未协商过格式时执行回退探测；成功后整个客户端不再重复 400 试探。
      if (response.status === 400 && this.#negotiatedFormat === null && format !== 'none') {
        const next: StructuredFormat | null =
          format === 'json_schema' ? 'json_object' : deepSeek ? null : 'none';
        if (next !== null) {
          trace.noteFailure(`接口返回 HTTP 400，正在将输出格式从 ${format} 切换为 ${next} 重试。`);
          response = await dispatch(
            next === 'none' ? undefined : responseFormatPayload(next, request),
          );
          if (response.status === 400 && next !== 'none') {
            trace.noteFailure('接口返回 HTTP 400，正在移除结构化输出参数后重试。');
            response = await dispatch();
            format = 'none';
          } else {
            format = next;
          }
        }
      }
      if (response.ok && this.#negotiatedFormat === null && !deepSeek)
        this.#negotiatedFormat = format;
      if (!response.ok) throw await responseError(response);
      const parsed = responseSchema.parse(await response.json());
      const raw = parsed.usage;
      const billing = this.#billing(raw, trace.requestedAt, response.headers, parsed.service_tier);
      const responseUsage = {
        ...usage(raw),
        ...trace.usage(billing),
      };
      const choice = parsed.choices[0];
      if (!choice) throw new ModelClientError('invalid_output', 'Model response had no choice.');
      if (choice.finish_reason === 'content_filter')
        throw new ModelClientError('content_rejected', 'Model provider rejected the content.');
      const calls = choice.message.tool_calls;
      if (calls && calls.length > 0) {
        return {
          kind: 'tool_calls',
          calls: calls.map((call) => {
            try {
              return {
                id: call.id,
                toolKey: call.function.name,
                input: JSON.parse(call.function.arguments) as unknown,
              };
            } catch (error) {
              throw new ModelClientError(
                'invalid_output',
                'Model tool arguments were not JSON.',
                false,
                { cause: error },
              );
            }
          }),
          usage: responseUsage,
        };
      }
      // 2、代码围栏在本地安全剥离；其他非 JSON（含 DeepSeek 偶发空正文）交给 Runner 修复一次。
      const content = choice.message.content ?? '';
      const structured = parseStructuredContent(content);
      return structured.parsed
        ? {
            kind: 'output',
            output: structured.value,
            usage: responseUsage,
          }
        : {
            kind: 'unparsed_output',
            text: content,
            usage: responseUsage,
          };
    } catch (error) {
      if (error instanceof ModelClientError) throw error;
      if (error instanceof ModelRequestPersistenceError) throw error;
      if (combined.aborted) {
        if (signal.aborted)
          throw new ModelClientError('cancelled', 'Model request was cancelled.', false, {
            cause: error,
          });
        throw new ModelClientError('timeout', 'Model request timed out.', true, { cause: error });
      }
      if (error instanceof z.ZodError)
        throw new ModelClientError(
          'invalid_output',
          'Model provider returned an invalid response.',
          false,
          { cause: error },
        );
      const reason = networkReason(error);
      throw new ModelClientError(
        'temporary',
        `Model provider request failed${reason ? ` (${reason})` : ''}.`,
        true,
        { cause: error },
      );
    }
  }
}

/** 将 OpenAI 兼容客户端注册到模型提供方注册表。 */
export function registerOpenAiCompatibleProvider(registry: {
  register(
    provider: string,
    factory: (config: Readonly<Record<string, unknown>>) => ModelClient,
  ): void;
}): void {
  registry.register(
    'openai-compatible',
    (value) => new OpenAiCompatibleModelClient(configSchema.parse(value)),
  );
}
