import type {
  CompanyLookupRepository,
  CompanySummary,
  JobDetail,
  JobListItem,
  JobQueryFilter,
  JobQueryPage,
  JobQueryRepository,
} from '@jobhunter/application';
import { parseId, utcInstant } from '@jobhunter/domain';
import type Database from 'better-sqlite3';
import { z } from 'zod';

const id = z.uuidv7();
const filterSchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    companyIds: z.array(id).max(100).optional(),
    statuses: z
      .array(z.enum(['active', 'stale', 'closed']))
      .max(3)
      .optional(),
    locations: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    jobFamilies: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    jobSubfamilies: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).optional(),
    minimumScore: z.number().min(0).max(100).optional(),
    profileVersionId: id.optional(),
    sort: z.enum(['updated_desc', 'published_desc', 'score_desc']).default('updated_desc'),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

const cursorSchema = z.object({ sortValue: z.number(), id: z.uuidv7() }).strict();

interface QueryCursor {
  readonly sortValue: number;
  readonly id: string;
}

interface JobQueryRow {
  readonly id: string;
  readonly company_id: string;
  readonly company_name: string;
  readonly title: string;
  readonly department: string | null;
  readonly job_family: string | null;
  readonly job_subfamily: string | null;
  readonly recruitment_category: 'internship' | 'campus' | 'social' | null;
  readonly locations_json: string;
  readonly status: 'active' | 'stale' | 'closed';
  readonly detail_url: string;
  readonly apply_url: string;
  readonly published_at: number | null;
  readonly updated_at: number;
  readonly score: number | null;
  readonly sort_value: number;
}

interface JobDetailRow extends JobQueryRow {
  readonly company_name: string;
  readonly source_id: string;
  readonly external_job_id: string;
  readonly employment_type: string | null;
  readonly experience_text: string | null;
  readonly education_text: string | null;
  readonly description: string;
  readonly first_seen_at: number;
  readonly last_seen_at: number;
  readonly closed_at: number | null;
}

function encodeCursor(cursor: QueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): QueryCursor {
  const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  return cursorSchema.parse(decoded);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function likePattern(value: string): string {
  return `%${value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
}

export class SqliteJobQueryRepository implements JobQueryRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public query(input: JobQueryFilter): JobQueryPage {
    const filter = filterSchema.parse(input);
    if (
      (filter.sort === 'score_desc' || filter.minimumScore !== undefined) &&
      !filter.profileVersionId
    ) {
      throw new TypeError('Score sorting and filtering require profileVersionId.');
    }

    const innerConditions: string[] = [];
    const innerParameters: unknown[] = [];
    const scoreExpression = filter.profileVersionId
      ? `(SELECT MAX(mr.total_score)
          FROM match_results mr
          JOIN job_revisions jr ON jr.id = mr.job_revision_id
          WHERE jr.job_id = j.id AND mr.profile_version_id = ?)`
      : 'NULL';
    const selectParameters: unknown[] = filter.profileVersionId ? [filter.profileVersionId] : [];

    if (filter.search) {
      innerConditions.push(
        `(j.title LIKE ? ESCAPE '!'
          OR COALESCE(j.department, '') LIKE ? ESCAPE '!'
          OR j.description LIKE ? ESCAPE '!')`,
      );
      const pattern = likePattern(filter.search);
      innerParameters.push(pattern, pattern, pattern);
    }
    if (filter.companyIds && filter.companyIds.length > 0) {
      innerConditions.push(`j.company_id IN (${placeholders(filter.companyIds.length)})`);
      innerParameters.push(...filter.companyIds);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      innerConditions.push(`j.status IN (${placeholders(filter.statuses.length)})`);
      innerParameters.push(...filter.statuses);
    }
    if (filter.locations && filter.locations.length > 0) {
      innerConditions.push(
        `EXISTS (SELECT 1 FROM json_each(j.locations_json) location
                 WHERE location.value IN (${placeholders(filter.locations.length)}))`,
      );
      innerParameters.push(...filter.locations);
    }
    if (filter.jobFamilies && filter.jobFamilies.length > 0) {
      innerConditions.push(
        `lower(COALESCE(j.job_family, '')) IN (${placeholders(filter.jobFamilies.length)})`,
      );
      innerParameters.push(...filter.jobFamilies.map((value) => value.toLowerCase()));
    }
    if (filter.jobSubfamilies && filter.jobSubfamilies.length > 0) {
      innerConditions.push(
        `lower(COALESCE(j.job_subfamily, '')) IN (${placeholders(filter.jobSubfamilies.length)})`,
      );
      innerParameters.push(...filter.jobSubfamilies.map((value) => value.toLowerCase()));
    }
    if (filter.recruitmentCategory) {
      innerConditions.push('j.recruitment_category = ?');
      innerParameters.push(filter.recruitmentCategory);
    }

    const sort = filter.sort;
    const sortExpression =
      sort === 'updated_desc'
        ? 'updated_at'
        : sort === 'published_desc'
          ? 'COALESCE(published_at, 0)'
          : 'COALESCE(score, -1)';
    const outerConditions: string[] = [];
    const outerParameters: unknown[] = [];
    if (filter.minimumScore !== undefined) {
      outerConditions.push('score >= ?');
      outerParameters.push(filter.minimumScore);
    }
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      outerConditions.push(`(${sortExpression} < ? OR (${sortExpression} = ? AND id > ?))`);
      outerParameters.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }

    const baseSql = `
      FROM (
        SELECT j.id, j.company_id, company.name AS company_name, j.title, j.department,
               j.job_family, j.job_subfamily, j.recruitment_category, j.locations_json,
               j.status, j.detail_url, j.apply_url, j.published_at, j.updated_at,
               ${scoreExpression} AS score
        FROM jobs j
        JOIN companies company ON company.id = j.company_id
        ${innerConditions.length > 0 ? `WHERE ${innerConditions.join(' AND ')}` : ''}
      ) query
      ${outerConditions.length > 0 ? `WHERE ${outerConditions.join(' AND ')}` : ''}`;
    const paged = filter.page !== undefined && !filter.cursor;
    const requestedPage = filter.page ?? 1;
    const pageSize = filter.pageSize ?? filter.limit;
    const total = paged
      ? (this.#client
          .prepare<unknown[], { readonly total: number }>(`SELECT COUNT(*) AS total ${baseSql}`)
          .get(...selectParameters, ...innerParameters, ...outerParameters)?.total ?? 0)
      : undefined;
    const page =
      paged && total !== undefined
        ? Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)))
        : requestedPage;
    const sql = `
      SELECT query.*, ${sortExpression} AS sort_value
      ${baseSql}
      ORDER BY sort_value DESC, id ASC
      LIMIT ?${paged ? ' OFFSET ?' : ''}`;
    const limit = pageSize;
    const queryLimit = limit + 1;
    const rows = this.#client
      .prepare<unknown[], JobQueryRow>(sql)
      .all(
        ...selectParameters,
        ...innerParameters,
        ...outerParameters,
        queryLimit,
        ...(paged ? [(page - 1) * limit] : []),
      );
    const pageRows = rows.slice(0, limit);
    const items: JobListItem[] = pageRows.map((row) => ({
      id: parseId(row.id, 'Job'),
      companyId: parseId(row.company_id, 'Company'),
      companyName: row.company_name,
      title: row.title,
      department: row.department,
      jobFamily: row.job_family,
      jobSubfamily: row.job_subfamily,
      recruitmentCategory: row.recruitment_category,
      locations: z.array(z.string()).parse(JSON.parse(row.locations_json) as unknown),
      status: row.status,
      detailUrl: row.detail_url,
      applyUrl: row.apply_url,
      publishedAt: row.published_at === null ? null : utcInstant(row.published_at),
      updatedAt: utcInstant(row.updated_at),
      score: row.score,
    }));
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ sortValue: last.sort_value, id: last.id })
          : null,
      ...(paged && total !== undefined ? { total, page, pageSize: limit } : {}),
    };
  }

  public get(
    jobId: Parameters<JobQueryRepository['get']>[0],
    profileVersionId?: Parameters<JobQueryRepository['get']>[1],
  ): JobDetail | null {
    const scoreExpression = profileVersionId
      ? `(SELECT MAX(mr.total_score)
          FROM match_results mr
          JOIN job_revisions jr ON jr.id = mr.job_revision_id
          WHERE jr.job_id = j.id AND mr.profile_version_id = ?)`
      : 'NULL';
    const row = this.#client
      .prepare<unknown[], JobDetailRow>(
        `
        SELECT j.id, j.company_id, company.name AS company_name, j.source_id,
               j.external_job_id, j.title, j.department, j.job_family, j.job_subfamily, j.locations_json,
               j.employment_type, j.recruitment_category, j.experience_text, j.education_text, j.description,
               j.status, j.detail_url, j.apply_url, j.published_at, j.updated_at,
               j.first_seen_at, j.last_seen_at, j.closed_at,
               ${scoreExpression} AS score, j.updated_at AS sort_value
        FROM jobs j
        JOIN companies company ON company.id = j.company_id
        WHERE j.id = ?`,
      )
      .get(...(profileVersionId ? [profileVersionId] : []), jobId);
    if (!row) return null;
    return {
      id: parseId(row.id, 'Job'),
      companyId: parseId(row.company_id, 'Company'),
      companyName: row.company_name,
      sourceId: parseId(row.source_id, 'JobSource'),
      externalJobId: row.external_job_id,
      title: row.title,
      department: row.department,
      jobFamily: row.job_family,
      jobSubfamily: row.job_subfamily,
      locations: z.array(z.string()).parse(JSON.parse(row.locations_json) as unknown),
      employmentType: row.employment_type,
      recruitmentCategory: row.recruitment_category,
      experienceText: row.experience_text,
      educationText: row.education_text,
      description: row.description,
      status: row.status,
      detailUrl: row.detail_url,
      applyUrl: row.apply_url,
      publishedAt: row.published_at === null ? null : utcInstant(row.published_at),
      updatedAt: utcInstant(row.updated_at),
      score: row.score,
      firstSeenAt: utcInstant(row.first_seen_at),
      lastSeenAt: utcInstant(row.last_seen_at),
      closedAt: row.closed_at === null ? null : utcInstant(row.closed_at),
    };
  }
}

interface CompanyRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export class SqliteCompanyLookupRepository implements CompanyLookupRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public findBySelector(selector: string): CompanySummary | null {
    const normalized = selector.trim();
    if (!normalized) return null;
    const row = this.#client
      .prepare<unknown[], CompanyRow>(
        `SELECT id, slug, name FROM companies
         WHERE id = ? OR lower(slug) = lower(?) OR lower(name) = lower(?)
            OR EXISTS (SELECT 1 FROM json_each(companies.aliases_json) alias
                       WHERE lower(alias.value) = lower(?))
         LIMIT 1`,
      )
      .get(normalized, normalized, normalized, normalized);
    return row ? { id: parseId(row.id, 'Company'), slug: row.slug, name: row.name } : null;
  }
}
