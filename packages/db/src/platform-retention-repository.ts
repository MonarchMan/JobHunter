import { randomUUID } from 'node:crypto';
import {
  platformRetentionStateSchema,
  platformRetentionCommandSchema,
  type PlatformRetentionCommand,
  type PlatformRetentionRepository,
  type PlatformRetentionResult,
} from '@jobhunter/application';
import { utcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { SqliteSettingsStore } from './settings.js';

/** 未知事件、现有分析及业务引用一律保护；不猜测它们是否可丢弃。 */
const protectedSql = `
EXISTS (SELECT 1 FROM job_revisions r JOIN match_results m ON m.job_revision_id=r.id WHERE r.job_id=j.id)
OR EXISTS (SELECT 1 FROM job_revisions r JOIN job_enrichments e ON e.job_revision_id=r.id WHERE r.job_id=j.id)
OR EXISTS (SELECT 1 FROM events e WHERE
  e.stream_id IN (SELECT id FROM job_revisions WHERE job_id=j.id) OR
  (e.stream_type='job' AND e.stream_id=j.id AND NOT (e.event_type='job.status.changed' AND coalesce(json_extract(e.payload_json,'$.reasonCode'),'')='first_observed'))
  OR (NOT (e.stream_type='job' AND e.stream_id=j.id AND e.event_type='job.status.changed' AND coalesce(json_extract(e.payload_json,'$.reasonCode'),'')='first_observed') AND EXISTS
    (SELECT 1 FROM json_tree(e.payload_json) v WHERE v.atom=j.id OR v.atom=j.detail_url OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))))
OR EXISTS (SELECT 1 FROM tasks t WHERE t.status IN ('pending','running') AND
  (t.task_type LIKE 'match.%' OR t.task_type LIKE 'job.%' OR EXISTS
    (SELECT 1 FROM json_tree(t.payload_json) v WHERE v.atom=j.id OR v.atom=j.external_job_id OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))))
OR EXISTS (SELECT 1 FROM files f,json_tree(f.properties_json) v WHERE v.atom=j.id OR v.atom=j.detail_url OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))
OR EXISTS (SELECT 1 FROM file_entity_mappings f,json_tree(f.metadata_json) v WHERE v.atom=j.id OR v.atom=j.detail_url OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))
OR EXISTS (SELECT 1 FROM resume_project_snapshots p,json_tree(p.project_json) v WHERE v.atom=j.id OR v.atom=j.detail_url OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))
OR EXISTS (SELECT 1 FROM drill_sessions d,json_tree(d.material_bindings_json) v WHERE v.atom=j.id OR v.atom=j.detail_url OR v.atom IN (SELECT id FROM job_revisions WHERE job_id=j.id))
`;
const candidatesSql = `SELECT j.id, (${protectedSql}) AS protected FROM jobs j JOIN job_sources s ON s.id=j.source_id WHERE s.source_kind='platform' AND max(j.created_at,j.last_seen_at,coalesce(j.last_interacted_at,0)) < ?`;

/** 所有控制变更和删除在写事务内，不涉及网络或官网数据。 */
export class SqlitePlatformRetentionRepository implements PlatformRetentionRepository {
  public constructor(private readonly client: Database.Database) {}

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
        const counts = this.client
          .prepare(
            `SELECT count(*) AS total,coalesce(sum(protected),0) AS protected FROM (${candidatesSql})`,
          )
          .get(cutoff) as { total: number; protected: number };
        // 2、每轮上限 100；引用在本事务内重检，已参与匹配或未知业务事件保留。
        if (
          command.action === 'run' &&
          state.enabled &&
          now - (state.lastRunAt ?? now) >= policy.intervalHours * 3_600_000
        ) {
          const candidates = this.client
            .prepare(`SELECT id FROM (${candidatesSql}) WHERE protected=0 ORDER BY id LIMIT 100`)
            .all(cutoff) as { id: string }[];
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
