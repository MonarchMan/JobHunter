export type ExternalResearchExecutorKey = 'codex-local' | 'browser-assisted-codex';

export interface ExternalResearchBrowserPolicy {
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
  readonly maximumSearches: number;
  readonly maximumPages: number;
  readonly maximumReadCalls: number;
  readonly maximumPageCharacters: number;
  readonly maximumTotalCharacters: number;
  readonly navigationTimeoutMs: number;
}

export interface ExternalResearchCollectionPlan {
  readonly version: 'community-browser-collection@v2';
  readonly queries: readonly string[];
  readonly priorityQueryCount: number;
  readonly relevanceTerms: readonly string[];
  readonly maximumSources: number;
}

export interface ExternalResearchInput {
  readonly requestId: string;
  readonly promptVersion: string;
  readonly prompt: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly collectionPlan: ExternalResearchCollectionPlan;
  readonly browserPolicy: ExternalResearchBrowserPolicy;
  readonly maximumOutputBytes: number;
  readonly timeoutMs: number;
}

export interface ExternalResearchOutput {
  readonly bundleText: string;
  readonly externalSessionId: string | null;
  readonly diagnosticSummary: string | null;
}

export interface ExternalResearchExecutor {
  readonly key: ExternalResearchExecutorKey;
  readonly version: string;
  readonly supportedPromptVersions: readonly string[];
  readonly capabilitySummary: Readonly<{
    liveWebSearch: boolean;
    browserTools: readonly ('search' | 'open' | 'readPage')[];
    sandbox: 'web-search-only-local-process' | 'isolated-evidence-local-process';
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
