import { sourceMetadataSchema, type JobSourceAdapter, type SourceMetadata } from './contract.js';
import { SourceError } from './errors.js';
import { validateOfficialUrl } from './url-policy.js';

export interface RegisteredSource<TConfig = unknown> {
  readonly adapter: JobSourceAdapter<TConfig>;
  readonly metadata: SourceMetadata;
  readonly config: TConfig;
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, JobSourceAdapter>();

  public register<TConfig, TDetail>(adapter: JobSourceAdapter<TConfig, TDetail>): void {
    const metadata = sourceMetadataSchema.parse(adapter.metadata);
    validateOfficialUrl(metadata.canonicalEntryUrl, metadata.officialHosts);
    if (metadata.capabilities.detail === 'required' && !adapter.fetchDetail) {
      throw new SourceError('invalid_config', `Adapter requires fetchDetail: ${metadata.key}`);
    }
    if (metadata.capabilities.detail === 'inline' && adapter.fetchDetail) {
      throw new SourceError(
        'invalid_config',
        `Inline-detail adapter must not expose fetchDetail: ${metadata.key}`,
      );
    }
    if (this.#adapters.has(metadata.key)) {
      throw new SourceError('invalid_config', `Duplicate adapter key: ${metadata.key}`);
    }
    this.#adapters.set(metadata.key, adapter as JobSourceAdapter);
  }

  public resolve<TConfig = unknown>(
    adapterKey: string,
    config: unknown,
  ): RegisteredSource<TConfig> {
    const adapter = this.#adapters.get(adapterKey);
    if (!adapter) {
      throw new SourceError('invalid_config', `No adapter is registered for key: ${adapterKey}`);
    }
    let parsed: unknown;
    try {
      parsed = adapter.configSchema.parse(config);
    } catch (error) {
      throw new SourceError('invalid_config', `Adapter configuration is invalid: ${adapterKey}`, {
        cause: error,
      });
    }
    return {
      adapter: adapter as JobSourceAdapter<TConfig>,
      metadata: adapter.metadata,
      config: parsed as TConfig,
    };
  }

  public keys(): readonly string[] {
    return [...this.#adapters.keys()].sort();
  }
}
