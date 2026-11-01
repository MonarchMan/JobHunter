import type Database from 'better-sqlite3';
import { z } from 'zod';
import { parseId, utcInstant, type JobId } from '@jobhunter/common/domain';
import { parseNormalizedJob } from '../domain/index.js';
import type {
  MatchingJobReader,
  RecruitmentMatchingRevision,
  CurrentMatchingJobFact,
} from '../contracts/matching-jobs.js';
/** 数据库查询结果对应的行结构。 */
interface RevisionRow {
  readonly id: string;
  readonly job_id: string;
  readonly status: 'active' | 'stale' | 'closed';
  readonly snapshot_json: string;
  readonly created_at: number;
  readonly last_seen_at: number;
}

/** 招聘侧匹配输入适配器，所有职位、修订和公司 SQL 均在所有者内部执行。 */
export class SqliteMatchingJobReader implements MatchingJobReader {
  readonly #client: Database.Database;
  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getRevision(id: RecruitmentMatchingRevision['id']): RecruitmentMatchingRevision | null {
    const row = this.#client
      .prepare(
        `SELECT r.id, r.job_id, j.status, r.snapshot_json, r.created_at, j.last_seen_at
         FROM job_revisions r JOIN jobs j ON j.id = r.job_id WHERE r.id = ?`,
      )
      .get(id) as RevisionRow | undefined;
    return row
      ? {
          id: parseId(row.id, 'JobRevision'),
          jobId: parseId(row.job_id, 'Job'),
          jobStatus: row.status,
          normalized: parseNormalizedJob(JSON.parse(row.snapshot_json) as unknown),
          createdAt: utcInstant(row.created_at),
          lastSeenAt: utcInstant(row.last_seen_at),
        }
      : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getLatestRevisionForJob(jobId: JobId): RecruitmentMatchingRevision | null {
    const row = this.#client
      .prepare(
        `SELECT r.id, r.job_id, j.status, r.snapshot_json, r.created_at, j.last_seen_at
         FROM job_revisions r JOIN jobs j ON j.id = r.job_id
         WHERE r.job_id = ? ORDER BY r.revision_no DESC LIMIT 1`,
      )
      .get(jobId) as RevisionRow | undefined;
    return row
      ? {
          id: parseId(row.id, 'JobRevision'),
          jobId: parseId(row.job_id, 'Job'),
          jobStatus: row.status,
          normalized: parseNormalizedJob(JSON.parse(row.snapshot_json) as unknown),
          createdAt: utcInstant(row.created_at),
          lastSeenAt: utcInstant(row.last_seen_at),
        }
      : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getCompanyContext(
    companyId: Parameters<MatchingJobReader['getCompanyContext']>[0],
  ): ReturnType<MatchingJobReader['getCompanyContext']> {
    const row = this.#client
      .prepare('SELECT industry, size_tag FROM companies WHERE id = ?')
      .get(companyId) as
      { readonly industry: string | null; readonly size_tag: string | null } | undefined;
    if (!row) throw new TypeError(`Company not found: ${companyId}.`);
    const sizeCategory =
      row.size_tag === 'large' || row.size_tag === 'medium' || row.size_tag === 'other'
        ? row.size_tag
        : null;
    return { industry: row.industry, sizeCategory };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listLatestRevisionIdsPage(
    input: Parameters<MatchingJobReader['listLatestRevisionIdsPage']>[0],
  ): ReturnType<MatchingJobReader['listLatestRevisionIdsPage']> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new TypeError('Job revision page limit is invalid.');
    }
    if (input.statuses.length === 0) return [];
    const statusPlaceholders = input.statuses.map(() => '?').join(', ');
    const normalizeKeyword = (value: string): string =>
      value.trim().replaceAll(/\s+/gu, '').toLocaleLowerCase();
    const targetRoles = (input.targetRoles ?? []).map(normalizeKeyword).filter(Boolean);
    const excludedTerms = (input.excludedTerms ?? []).map(normalizeKeyword).filter(Boolean);
    const searchable = `lower(replace(replace(replace(replace(
      coalesce(j.title, '') || ' ' || coalesce(j.department, '') || ' ' ||
      coalesce(j.job_family, '') || ' ' || coalesce(j.description, '') || ' ' ||
      coalesce(j.experience_text, '') || ' ' || coalesce(j.education_text, ''),
      ' ', ''), char(9), ''), char(10), ''), char(13), ''))`;
    const targetRoleCondition = targetRoles.length
      ? `AND (${targetRoles.map(() => `instr(${searchable}, ?) > 0`).join(' OR ')})`
      : '';
    const excludedTermCondition = excludedTerms.length
      ? `AND NOT (${excludedTerms.map(() => `instr(${searchable}, ?) > 0`).join(' OR ')})`
      : '';
    const rows = this.#client
      .prepare(
        `SELECT r.id
         FROM job_revisions r
         JOIN jobs j ON j.id = r.job_id
         WHERE j.status IN (${statusPlaceholders})
           AND NOT EXISTS (
             SELECT 1 FROM job_revisions newer
             WHERE newer.job_id = r.job_id AND newer.revision_no > r.revision_no
           )
           ${targetRoleCondition}
           ${excludedTermCondition}
           AND (? IS NULL OR r.id > ?)
           ORDER BY r.id ASC LIMIT ?`,
      )
      .all(
        ...input.statuses,
        ...targetRoles,
        ...excludedTerms,
        input.afterId,
        input.afterId,
        input.limit,
      ) as {
      readonly id: string;
    }[];
    return rows.map((row) => parseId(row.id, 'JobRevision'));
  }
  /** 提供当前修订和职位排序事实，供匹配侧关联自身结果。 */
  public listCurrentJobFacts(): readonly CurrentMatchingJobFact[] {
    return z
      .array(
        z.object({
          jobId: z.string(),
          revisionId: z.string(),
          title: z.string(),
          status: z.enum(['active', 'stale', 'closed']),
          publishedAt: z.number().nullable(),
          lastSeenAt: z.number(),
        }),
      )
      .parse(
        this.#client
          .prepare(
            `SELECT j.id AS jobId, r.id AS revisionId, j.title, j.status, j.published_at AS publishedAt, j.last_seen_at AS lastSeenAt FROM jobs j JOIN job_revisions r ON r.id=(SELECT latest.id FROM job_revisions latest WHERE latest.job_id=j.id ORDER BY latest.revision_no DESC LIMIT 1)`,
          )
          .all(),
      );
  }
}
