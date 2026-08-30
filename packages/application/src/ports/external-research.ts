export interface ExternalResearchInput {
  readonly requestId: string;
  readonly prompt: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly maximumOutputBytes: number;
  readonly timeoutMs: number;
}

export interface ExternalResearchOutput {
  readonly bundleText: string;
  readonly externalSessionId: string | null;
  readonly diagnosticSummary: string | null;
}

export interface ExternalResearchExecutor {
  readonly key: string;
  readonly version: string;
  readonly capabilitySummary: Readonly<{
    liveWebSearch: boolean;
    sandbox: 'web-search-only-local-process';
  }>;
  execute(input: ExternalResearchInput, signal: AbortSignal): Promise<ExternalResearchOutput>;
}

export class ExternalResearchExecutorError extends Error {
  public constructor(
    readonly category: 'missing' | 'invalid_config' | 'temporary' | 'cancelled' | 'permanent',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalResearchExecutorError';
  }
}
