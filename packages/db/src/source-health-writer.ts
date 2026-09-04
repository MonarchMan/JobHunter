import type { SourceHealthWriter } from '@jobhunter/application';
import { canonicalJson, type JobSourceId } from '@jobhunter/domain';
import type { SourceHealth } from '@jobhunter/source-core';
import type Database from 'better-sqlite3';

/** 写入来源探活结果并维护连续失败与健康状态。 */
export class SqliteSourceHealthWriter implements SourceHealthWriter {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public record(sourceId: JobSourceId, health: SourceHealth): void {
    const changed = this.#client
      .prepare(
        `UPDATE job_sources SET probe_status = ?, last_probe_at = ?,
           probe_error_category = ?, probe_diagnostics_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        health.status,
        health.checkedAt,
        health.errorCategory,
        canonicalJson({ signals: health.signals, latencyMs: health.latencyMs }),
        health.checkedAt,
        sourceId,
      ).changes;
    if (changed !== 1) throw new TypeError('Source not found.');
  }
}
