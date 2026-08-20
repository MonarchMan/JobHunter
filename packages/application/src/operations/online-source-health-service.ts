import type { JobSourceId } from '@jobhunter/domain';
import {
  SourceError,
  type AdapterRegistry,
  type SourceHealth,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import type { SyncSourceRecord } from '../sync/model.js';

export interface OnlineSourceHealthResult {
  readonly sourceId: JobSourceId;
  readonly adapterKey: string;
  readonly health: SourceHealth;
}

export class OnlineSourceHealthService {
  readonly #registry: AdapterRegistry;
  readonly #context: (
    source: SyncSourceRecord,
    parsedConfig: unknown,
    signal: AbortSignal,
  ) => SourceRequestContext<unknown>;
  readonly #now: () => number;

  public constructor(input: {
    readonly registry: AdapterRegistry;
    readonly createContext: (
      source: SyncSourceRecord,
      parsedConfig: unknown,
      signal: AbortSignal,
    ) => SourceRequestContext<unknown>;
    readonly now?: () => number;
  }) {
    this.#registry = input.registry;
    this.#context = input.createContext;
    this.#now = input.now ?? Date.now;
  }

  public async check(
    sources: readonly SyncSourceRecord[],
    signal: AbortSignal,
  ): Promise<readonly OnlineSourceHealthResult[]> {
    const results: OnlineSourceHealthResult[] = [];
    for (const source of sources) {
      signal.throwIfAborted();
      const startedAt = this.#now();
      try {
        const registered = this.#registry.resolve(source.adapterKey, source.config);
        const health = await registered.adapter.healthCheck(
          this.#context(source, registered.config, signal),
        );
        results.push({ sourceId: source.id, adapterKey: source.adapterKey, health });
      } catch (error) {
        const category = error instanceof SourceError ? error.category : 'temporary';
        results.push({
          sourceId: source.id,
          adapterKey: source.adapterKey,
          health: {
            status: 'unhealthy',
            checkedAt: this.#now(),
            latencyMs: Math.max(0, this.#now() - startedAt),
            signals: [{ key: 'health-check', ok: false, diagnostic: '来源健康检查失败。' }],
            errorCategory: category,
          },
        });
      }
    }
    return results;
  }
}
