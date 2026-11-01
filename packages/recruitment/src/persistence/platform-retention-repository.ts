import { z } from 'zod';
import type { ResourceReferenceReader } from '@jobhunter/common/resource-references';
import { randomUUID } from 'node:crypto';
import {
  platformRetentionStateSchema,
  platformRetentionCommandSchema,
  type PlatformRetentionCommand,
  type PlatformRetentionRepository,
  type PlatformRetentionResult,
} from '../platform/application/platform-retention.js';
import { utcInstant } from '@jobhunter/common/domain';
import type Database from 'better-sqlite3';
import { SqliteSettingsStore } from '@jobhunter/recruitment/persistence/settings';

/** 招聘所有者只读取待清理职位，引用保护委托给各数据所有者。 */
const candidatesSql = `SELECT j.id, j.detail_url, j.external_job_id FROM jobs j JOIN job_sources s ON s.id=j.source_id WHERE s.source_kind='platform' AND max(j.created_at,j.last_seen_at,coalesce(j.last_interacted_at,0)) < ? ORDER BY j.id`;

/** 所有控制变更和删除在写事务内，不涉及网络或官网数据。 */
export class SqlitePlatformRetentionRepository implements PlatformRetentionRepository {
  public constructor(
    private readonly client: Database.Database,
    private readonly references: readonly ResourceReferenceReader[],
  ) {
    if (references.length === 0)
      throw new TypeError('Retention reference participants are required.');
  }

  /** 所有引用检查都在调用方持有的即时事务中同步执行。 */
  #candidates(cutoff: number): readonly { readonly id: string; readonly protected: boolean }[] {
    const rows = z
      .array(z.object({ id: z.string(), detail_url: z.string(), external_job_id: z.string() }))
      .parse(this.client.prepare(candidatesSql).all(cutoff));
    return rows.map((row) => {
      const versionIds = z
        .array(z.string())
        .parse(
          this.client.prepare('SELECT id FROM job_revisions WHERE job_id=?').pluck().all(row.id),
        );
      const subject = {
        id: row.id,
        aliases: [row.detail_url],
        executionAliases: [row.external_job_id],
        versionIds,
        streamType: 'job',
        ignoredEventType: 'job.status.changed',
        ignoredReasonCode: 'first_observed',
        broadTaskPrefixes: ['match.', 'job.'],
      };
      return {
        id: row.id,
        protected: this.references.some((reader) => reader.isReferenced(subject)),
      };
    });
  }

  /** 预览不删除，启用延后一周期；执行重算候选而不信任预览清单。 */
  public execute(input: PlatformRetentionCommand, now: number): PlatformRetentionResult {
    const command = platformRetentionCommandSchema.parse(input);
    return this.client
      .transaction(() => {
        // 1、策略和确认与业务数据共用事务，禁止并发禁用后仍继续删除。
        const settings = new SqliteSettingsStore(this.client);
        const state = platformRetentionStateSchema.parse(
          settings.get('platform.retention') ?? {
            policy: { retentionDays: 30, intervalHours: 6 },
            enabled: false,
            lastRunAt: null,
            preview: null,
          },
        );
        let deleted = 0;
        // 1.a、默认关闭或尚未到期时不扫描全库、不写控制设置。
        if (
          command.action === 'run' &&
          (!state.enabled ||
            now - (state.lastRunAt ?? now) < state.policy.intervalHours * 3_600_000)
        )
          return {
            enabled: state.enabled,
            policy: state.policy,
            eligible: 0,
            protected: 0,
            deleted: 0,
            skipped: true,
          };
        if (command.action === 'preview')
          state.preview = { token: randomUUID(), expiresAt: now + 300_000, policy: command.policy };
        if (command.action === 'enable') {
          if (state.preview?.token !== command.confirmationToken || state.preview.expiresAt <= now)
            throw new Error('Preview confirmation expired.');
          state.policy = state.preview.policy;
          state.enabled = true;
          state.lastRunAt = now;
          state.preview = null;
        }
        if (command.action === 'disable') {
          state.enabled = false;
          state.preview = null;
        }
        if (command.action === 'touch')
          this.client
            .prepare(
              "UPDATE jobs SET last_interacted_at=max(coalesce(last_interacted_at,0),?) WHERE id=? AND source_id IN (SELECT id FROM job_sources WHERE source_kind='platform')",
            )
            .run(now, command.jobId);
        const policy = command.action === 'preview' ? command.policy : state.policy;
        const cutoff = now - policy.retentionDays * 86_400_000;
        const snapshot = this.#candidates(cutoff);
        const counts = {
          total: snapshot.length,
          protected: snapshot.filter((candidate) => candidate.protected).length,
        };
        // 2、每轮上限 100；引用在本事务内重检，已参与匹配或未知业务事件保留。
        if (
          command.action === 'run' &&
          state.enabled &&
          now - (state.lastRunAt ?? now) >= policy.intervalHours * 3_600_000
        ) {
          const candidates = snapshot.filter((candidate) => !candidate.protected).slice(0, 100);
          for (const candidate of candidates) {
            this.client.prepare('DELETE FROM job_observations WHERE job_id=?').run(candidate.id);
            this.client
              .prepare(
                "DELETE FROM events WHERE stream_type='job' AND stream_id=? AND event_type='job.status.changed' AND json_extract(payload_json,'$.reasonCode')='first_observed'",
              )
              .run(candidate.id);
            this.client.prepare('DELETE FROM job_revisions WHERE job_id=?').run(candidate.id);
            deleted += this.client.prepare('DELETE FROM jobs WHERE id=?').run(candidate.id).changes;
          }
          state.lastRunAt = now;
          this.client
            .prepare(
              "INSERT INTO events(id,stream_type,stream_id,sequence_no,event_type,payload_json,occurred_at) SELECT ?,'maintenance','platform-retention',coalesce(max(sequence_no),0)+1,'platform.retention.completed',?,? FROM events WHERE stream_type='maintenance' AND stream_id='platform-retention'",
            )
            .run(
              randomUUID(),
              JSON.stringify({ deleted, protected: counts.protected, policy }),
              now,
            );
        }
        // 3、状态只记录计数／策略；物理空间回收交给既有 SQLite 维护。
        if (command.action !== 'status' && command.action !== 'touch')
          settings.set('platform.retention', state, utcInstant(now));
        return {
          enabled: state.enabled,
          policy,
          eligible: counts.total - counts.protected,
          protected: counts.protected,
          deleted,
          ...(command.action === 'preview'
            ? {
                warning:
                  '启用后将定期永久删除无保护引用的陈旧平台职位、修订和观察，无法撤销；请先备份。',
              }
            : {}),
          ...(command.action === 'preview' && state.preview
            ? { confirmationToken: state.preview.token, expiresAt: state.preview.expiresAt }
            : {}),
        };
      })
      .immediate();
  }
}
