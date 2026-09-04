import { parseId, type JobSourceId } from '@jobhunter/domain';
import type { SourceHealth } from '@jobhunter/source-core';
import type { SyncRepository, SyncSourceRecord } from './model.js';

/** 应用层数据结构或端口契约。 */
export interface SourceHealthChecker {
  check(
    sources: readonly SyncSourceRecord[],
    signal: AbortSignal,
  ): Promise<readonly { readonly sourceId: JobSourceId; readonly health: SourceHealth }[]>;
}

/** 应用层数据结构或端口契约。 */
export interface SourceHealthWriter {
  record(sourceId: JobSourceId, health: SourceHealth): void;
}

/** 执行来源探活并映射为统一健康状态。 */
export class SourceHealthCheckService {
  readonly #sources: Pick<SyncRepository, 'getSource'>;
  readonly #checker: SourceHealthChecker;
  readonly #writer: SourceHealthWriter;

  public constructor(input: {
    readonly sources: Pick<SyncRepository, 'getSource'>;
    readonly checker: SourceHealthChecker;
    readonly writer: SourceHealthWriter;
  }) {
    this.#sources = input.sources;
    this.#checker = input.checker;
    this.#writer = input.writer;
  }

  /** 检查来源并持久化成功、降级或失败结果。 */
  public async check(sourceId: string, signal: AbortSignal): Promise<SourceHealth> {
    const source = this.#sources.getSource(parseId(sourceId, 'JobSource'));
    if (!source) throw new TypeError('Source not found.');
    const result = (await this.#checker.check([source], signal))[0];
    if (!result) throw new TypeError('Source health check returned no result.');
    this.#writer.record(source.id, result.health);
    return result.health;
  }
}
