import type { SourceHealthWriter } from '@jobhunter/application';
import type { JobSourceId } from '@jobhunter/domain';
import type { SourceHealth } from '@jobhunter/source-core';
import type Database from 'better-sqlite3';

export class SqliteSourceHealthWriter implements SourceHealthWriter {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public record(sourceId: JobSourceId, health: SourceHealth): void {
    const successAt = health.status === 'healthy' ? health.checkedAt : null;
    const failureAt = health.status === 'healthy' ? null : health.checkedAt;
    const changed = this.#client
      .prepare(
        `UPDATE job_sources SET health_status = ?,
           last_success_at = COALESCE(?, last_success_at),
           last_failure_at = COALESCE(?, last_failure_at), updated_at = ?
         WHERE id = ?`,
      )
      .run(health.status, successAt, failureAt, health.checkedAt, sourceId).changes;
    if (changed !== 1) throw new TypeError('Source not found.');
  }
}
