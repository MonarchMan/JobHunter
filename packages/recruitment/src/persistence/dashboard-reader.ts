import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  RecruitmentDashboardReader,
  RecruitmentDashboardSnapshot,
} from '../contracts/dashboard.js';

/** 仅访问招聘模块的职位、公司、来源与同步表。 */
export class SqliteRecruitmentDashboardReader implements RecruitmentDashboardReader {
  public constructor(private readonly client: Database.Database) {}

  public snapshot(): RecruitmentDashboardSnapshot {
    // 1、通过职位修订索引获取最新身份；未形成修订的职位仍计入职位总数。
    const rows = z
      .array(
        z.object({
          id: z.string(),
          companyName: z.string(),
          title: z.string(),
          locations: z.string(),
          status: z.string(),
          latestRevisionId: z.string().nullable(),
          publishedAt: z.number().nullable(),
          updatedAt: z.number(),
          firstSeenAt: z.number(),
        }),
      )
      .parse(
        this.client
          .prepare(
            `SELECT j.id, c.name AS companyName, j.title, j.locations_json AS locations, j.status, (SELECT r.id FROM job_revisions r WHERE r.job_id=j.id ORDER BY r.revision_no DESC LIMIT 1) AS latestRevisionId, j.published_at AS publishedAt, j.updated_at AS updatedAt, j.first_seen_at AS firstSeenAt FROM jobs j JOIN companies c ON c.id=j.company_id`,
          )
          .all(),
      );
    // 2、分别读取来源计数与最近完成同步，所有查询均保持只读。
    const count = (sql: string): number => Number(this.client.prepare(sql).pluck().get());
    const latest = z
      .object({ sourceName: z.string(), status: z.string(), finishedAt: z.number() })
      .optional()
      .parse(
        this.client
          .prepare(
            `SELECT c.name AS sourceName, sr.status, sr.finished_at AS finishedAt FROM sync_runs sr JOIN job_sources js ON js.id=sr.source_id JOIN companies c ON c.id=js.company_id WHERE sr.finished_at IS NOT NULL ORDER BY sr.finished_at DESC, sr.id DESC LIMIT 1`,
          )
          .get(),
      );
    return {
      activeJobs: rows.filter((row) => row.status === 'active').length,
      sources: {
        healthy: count(
          "SELECT count(*) FROM job_sources WHERE enabled=1 AND health_status='healthy'",
        ),
        total: count('SELECT count(*) FROM job_sources WHERE enabled=1'),
      },
      latestSync: latest
        ? { ...latest, finishedAt: new Date(latest.finishedAt).toISOString() }
        : null,
      jobs: rows.map((row) => ({
        ...row,
        locations: z.array(z.string()).parse(JSON.parse(row.locations) as unknown),
      })),
    };
  }
}
