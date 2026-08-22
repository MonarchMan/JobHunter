import { parseId, type JobSourceId } from '@jobhunter/domain';
import type { SourceHealth } from '@jobhunter/source-core';
import type { SyncRepository, SyncSourceRecord } from './model.js';

export interface SourceHealthChecker {
  check(
    sources: readonly SyncSourceRecord[],
    signal: AbortSignal,
  ): Promise<readonly { readonly sourceId: JobSourceId; readonly health: SourceHealth }[]>;
}

export interface SourceHealthWriter {
  record(sourceId: JobSourceId, health: SourceHealth): void;
}

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

  public async check(sourceId: string, signal: AbortSignal): Promise<SourceHealth> {
    const source = this.#sources.getSource(parseId(sourceId, 'JobSource'));
    if (!source) throw new TypeError('Source not found.');
    const result = (await this.#checker.check([source], signal))[0];
    if (!result) throw new TypeError('Source health check returned no result.');
    this.#writer.record(source.id, result.health);
    return result.health;
  }
}
