import { sourceMetadataSchema, type JobSourceAdapter, type SourceMetadata } from './contract.js';
import { SourceError } from './errors.js';
import { validateOfficialUrl } from './url-policy.js';

/** 来源适配器使用的数据结构或契约。 */
export interface RegisteredSource<TConfig = unknown> {
  readonly adapter: JobSourceAdapter<TConfig>;
  readonly metadata: SourceMetadata;
  readonly config: TConfig;
}

/** 校验、注册并解析职位来源适配器。 */
export class AdapterRegistry {
  readonly #adapters = new Map<string, JobSourceAdapter>();

  /** 注册来源并校验元数据、详情能力和唯一键。 */
  public register<TConfig, TDetail>(adapter: JobSourceAdapter<TConfig, TDetail>): void {
    const metadata = sourceMetadataSchema.parse(adapter.metadata);
    validateOfficialUrl(metadata.canonicalEntryUrl, metadata.officialHosts);
    if (metadata.capabilities.detail === 'deferred' && !adapter.fetchDetail) {
      throw new SourceError(
        'invalid_config',
        `Deferred-detail adapter requires fetchDetail: ${metadata.key}`,
      );
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

  /** 解析来源配置并返回可执行注册项。 */
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

  /** 返回按稳定顺序排列的来源键。 */
  public keys(): readonly string[] {
    return [...this.#adapters.keys()].sort();
  }
}
