export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicros: number;
}

export interface ModelToolSpec {
  readonly key: string;
  readonly description: string;
}

export interface ModelToolResult {
  readonly callId: string;
  readonly toolKey: string;
  readonly output: unknown;
}

export interface ModelRequest {
  readonly systemPrompt: string;
  readonly input: unknown;
  readonly outputSchemaName: string;
  readonly outputJsonSchema: unknown;
  readonly maxOutputTokens: number;
  readonly tools: readonly ModelToolSpec[];
  readonly toolResults: readonly ModelToolResult[];
  readonly repair?: {
    readonly invalidOutput: unknown;
    readonly validationSummary: string;
  };
}

export interface ModelOutputResponse {
  readonly kind: 'output';
  readonly output: unknown;
  readonly usage: ModelUsage;
}

export interface ModelToolCallResponse {
  readonly kind: 'tool_calls';
  readonly calls: readonly {
    readonly id: string;
    readonly toolKey: string;
    readonly input: unknown;
  }[];
  readonly usage: ModelUsage;
}

export type ModelResponse = ModelOutputResponse | ModelToolCallResponse;

export interface ModelClient {
  readonly metadata: {
    readonly provider: string;
    readonly model: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly costCurrency: string;
    readonly pricingVersion: string;
  };

  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}
