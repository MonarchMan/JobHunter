import type { ModelBilling, ModelRequestRecord } from '../contracts/model-usage.js';
/** 传输层生命周期通知；调用方同步持久化，禁止吞掉账本写入失败。 */
export interface ModelRequestObserver {
  save(record: ModelRequestRecord): void;
}
/** 模块数据结构或契约。 */
export interface ModelUsage {
  /** 一次 complete 可能包含格式协商的多次 HTTP；有此数组时不重复累加 billing。 */
  readonly billingCalls?: readonly ModelBilling[];
  readonly billing?: ModelBilling;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 仅当存在已上报用量但缺少单价的请求时为 null；未上报用量的失败请求按 0 计入。 */
  readonly estimatedCostMicros: number | null;
}

/** 模块数据结构或契约。 */
export interface ModelToolSpec {
  readonly key: string;
  readonly description: string;
}

/** 模块数据结构或契约。 */
export interface ModelToolResult {
  readonly callId: string;
  readonly toolKey: string;
  readonly output: unknown;
}

/** 模块数据结构或契约。 */
export interface ModelRequest {
  readonly systemPrompt: string;
  readonly input: unknown;
  readonly outputSchemaName: string;
  readonly outputJsonSchema: unknown;
  readonly maxOutputTokens?: number;
  readonly tools: readonly ModelToolSpec[];
  readonly toolResults: readonly ModelToolResult[];
  readonly repair?: {
    readonly invalidOutput: unknown;
    readonly validationSummary: string;
  };
}

/** 模块数据结构或契约。 */
export interface ModelOutputResponse {
  readonly kind: 'output';
  readonly output: unknown;
  readonly usage: ModelUsage;
}

/** Provider 返回了终止正文但无法解析为 JSON；原文只允许交给一次内存内修复。 */
export interface ModelUnparsedOutputResponse {
  readonly kind: 'unparsed_output';
  readonly text: string;
  readonly usage: ModelUsage;
}

/** 模块数据结构或契约。 */
export interface ModelToolCallResponse {
  readonly kind: 'tool_calls';
  readonly calls: readonly {
    readonly id: string;
    readonly toolKey: string;
    readonly input: unknown;
  }[];
  readonly usage: ModelUsage;
}

/** 模块使用的类型约束。 */
export type ModelResponse =
  ModelOutputResponse | ModelUnparsedOutputResponse | ModelToolCallResponse;

/** 模块数据结构或契约。 */
export interface ModelClient {
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly costCurrency: string;
    readonly pricingVersion: string;
  };

  complete(
    request: ModelRequest,
    signal: AbortSignal,
    observer?: ModelRequestObserver,
  ): Promise<ModelResponse>;
}
