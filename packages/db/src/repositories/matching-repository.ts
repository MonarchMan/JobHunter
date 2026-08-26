import type {
  CurrentMatchListItem,
  CurrentMatchPage,
  JobEnrichmentRecord,
  MatchAdviceRecord,
  MatchingRepository,
  MatchingJobRevisionRecord,
  MatchResultRecord,
  MatchRulesetRecord,
} from '@jobhunter/application';
import {
  canonicalJson,
  parseContentHash,
  parseId,
  parseNormalizedJob,
  utcInstant,
  type JobId,
} from '@jobhunter/domain';
import {
  parseDeterministicMatchOutput,
  jobAdviceSchema,
  parseJobUnderstanding,
  parseMatchRuleset,
} from '@jobhunter/matching';
import type Database from 'better-sqlite3';
import { z } from 'zod';

interface RevisionRow {
  readonly id: string;
  readonly job_id: string;
  readonly status: 'active' | 'stale' | 'closed';
  readonly snapshot_json: string;
  readonly created_at: number;
  readonly last_seen_at: number;
}

interface EnrichmentRow {
  readonly id: string;
  readonly job_revision_id: string;
  readonly agent_run_id: string;
  readonly schema_version: string;
  readonly content_hash: string;
  readonly result_json: string;
  readonly created_at: number;
}

interface RulesetRow {
  readonly id: string;
  readonly version: string;
  readonly definition_json: string;
  readonly definition_hash: string;
  readonly active: number;
  readonly created_at: number;
}

interface MatchRow {
  readonly id: string;
  readonly profile_version_id: string;
  readonly job_revision_id: string;
  readonly job_enrichment_id: string | null;
  readonly ruleset_id: string;
  readonly filter_status: 'eligible' | 'excluded' | 'uncertain';
  readonly total_score: number;
  readonly components_json: string;
  readonly risks_json: string;
  readonly input_hash: string;
  readonly created_at: number;
}

interface AdviceRow {
  readonly id: string;
  readonly match_result_id: string;
  readonly agent_run_id: string;
  readonly schema_version: string;
  readonly content_hash: string;
  readonly result_json: string;
  readonly created_at: number;
}

interface CurrentMatchRow extends MatchRow {
  readonly job_id: string;
  readonly title: string;
  readonly job_status: 'active' | 'stale' | 'closed';
  readonly published_at: number | null;
  readonly last_seen_at: number;
  readonly ruleset_version: string;
  readonly recency: number;
}

const currentMatchCursorSchema = z
  .object({ score: z.number(), recency: z.number(), jobId: z.uuidv7() })
  .strict();

function encodeCurrentMatchCursor(row: CurrentMatchRow): string {
  return Buffer.from(
    JSON.stringify({ score: row.total_score, recency: row.recency, jobId: row.job_id }),
    'utf8',
  ).toString('base64url');
}

function decodeCurrentMatchCursor(value: string): z.infer<typeof currentMatchCursorSchema> {
  try {
    return currentMatchCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
    );
  } catch (error) {
    throw new TypeError('Current match cursor is invalid.', { cause: error });
  }
}

function enrichment(row: EnrichmentRow): JobEnrichmentRecord {
  return {
    id: parseId(row.id, 'JobEnrichment'),
    jobRevisionId: parseId(row.job_revision_id, 'JobRevision'),
    agentRunId: row.agent_run_id,
    schemaVersion: row.schema_version,
    contentHash: parseContentHash(row.content_hash),
    result: parseJobUnderstanding(JSON.parse(row.result_json) as unknown),
    createdAt: utcInstant(row.created_at),
  };
}

function ruleset(row: RulesetRow): MatchRulesetRecord {
  return {
    id: parseId(row.id, 'MatchRuleset'),
    version: row.version,
    definition: parseMatchRuleset(JSON.parse(row.definition_json) as unknown),
    definitionHash: parseContentHash(row.definition_hash),
    active: row.active === 1,
    createdAt: utcInstant(row.created_at),
  };
}

function match(row: MatchRow): MatchResultRecord {
  const output = parseDeterministicMatchOutput({
    filterStatus: row.filter_status,
    totalScore: row.total_score,
    components: JSON.parse(row.components_json) as unknown,
    ruleOutcomes: JSON.parse(row.risks_json) as unknown,
  });
  return {
    id: parseId(row.id, 'MatchResult'),
    profileVersionId: parseId(row.profile_version_id, 'ProfileVersion'),
    jobRevisionId: parseId(row.job_revision_id, 'JobRevision'),
    jobEnrichmentId:
      row.job_enrichment_id === null ? null : parseId(row.job_enrichment_id, 'JobEnrichment'),
    rulesetId: parseId(row.ruleset_id, 'MatchRuleset'),
    ...output,
    inputHash: parseContentHash(row.input_hash),
    createdAt: utcInstant(row.created_at),
  };
}

const enrichmentColumns =
  'id, job_revision_id, agent_run_id, schema_version, content_hash, result_json, created_at';
const rulesetColumns = 'id, version, definition_json, definition_hash, active, created_at';
const matchColumns = `id, profile_version_id, job_revision_id, job_enrichment_id, ruleset_id,
                      filter_status, total_score, components_json, risks_json, input_hash, created_at`;
const adviceColumns =
  'id, match_result_id, agent_run_id, schema_version, content_hash, result_json, created_at';

function advice(row: AdviceRow): MatchAdviceRecord {
  return {
    id: parseId(row.id, 'MatchAdvice'),
    matchResultId: parseId(row.match_result_id, 'MatchResult'),
    agentRunId: row.agent_run_id,
    schemaVersion: row.schema_version,
    contentHash: parseContentHash(row.content_hash),
    result: jobAdviceSchema.parse(JSON.parse(row.result_json) as unknown),
    createdAt: utcInstant(row.created_at),
  };
}

export class SqliteMatchingRepository implements MatchingRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public getRevision(id: MatchingJobRevisionRecord['id']): MatchingJobRevisionRecord | null {
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

  public getLatestRevisionForJob(jobId: JobId): MatchingJobRevisionRecord | null {
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

  public getCompanyContext(
    companyId: Parameters<MatchingRepository['getCompanyContext']>[0],
  ): ReturnType<MatchingRepository['getCompanyContext']> {
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

  public getEnrichment(id: JobEnrichmentRecord['id']): JobEnrichmentRecord | null {
    const row = this.#client
      .prepare(`SELECT ${enrichmentColumns} FROM job_enrichments WHERE id = ?`)
      .get(id) as EnrichmentRow | undefined;
    return row ? enrichment(row) : null;
  }

  public getLatestEnrichmentForRevision(
    jobRevisionId: JobEnrichmentRecord['jobRevisionId'],
  ): JobEnrichmentRecord | null {
    const row = this.#client
      .prepare(
        `SELECT ${enrichmentColumns} FROM job_enrichments
         WHERE job_revision_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(jobRevisionId) as EnrichmentRow | undefined;
    return row ? enrichment(row) : null;
  }

  public saveEnrichment(record: JobEnrichmentRecord): JobEnrichmentRecord {
    this.#client
      .prepare(
        `INSERT INTO job_enrichments
         (id, job_revision_id, agent_run_id, schema_version, content_hash, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_revision_id, agent_run_id) DO NOTHING`,
      )
      .run(
        record.id,
        record.jobRevisionId,
        record.agentRunId,
        record.schemaVersion,
        record.contentHash,
        canonicalJson(record.result),
        record.createdAt,
      );
    const row = this.#client
      .prepare(
        `SELECT ${enrichmentColumns} FROM job_enrichments
         WHERE job_revision_id = ? AND agent_run_id = ?`,
      )
      .get(record.jobRevisionId, record.agentRunId) as EnrichmentRow | undefined;
    if (!row) throw new Error('Job enrichment persistence did not produce a row.');
    return enrichment(row);
  }

  public getRuleset(id: MatchRulesetRecord['id']): MatchRulesetRecord | null {
    const row = this.#client
      .prepare(`SELECT ${rulesetColumns} FROM match_rulesets WHERE id = ?`)
      .get(id) as RulesetRow | undefined;
    return row ? ruleset(row) : null;
  }

  public getActiveRuleset(): MatchRulesetRecord | null {
    const row = this.#client
      .prepare(`SELECT ${rulesetColumns} FROM match_rulesets WHERE active = 1`)
      .get() as RulesetRow | undefined;
    return row ? ruleset(row) : null;
  }

  public upsertRuleset(record: MatchRulesetRecord): MatchRulesetRecord {
    return this.#client.transaction(() => {
      if (record.active) this.#client.prepare('UPDATE match_rulesets SET active = 0').run();
      this.#client
        .prepare(
          `INSERT INTO match_rulesets
           (id, version, definition_json, definition_hash, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(version) DO UPDATE SET active = excluded.active`,
        )
        .run(
          record.id,
          record.version,
          canonicalJson(record.definition),
          record.definitionHash,
          record.active ? 1 : 0,
          record.createdAt,
        );
      const row = this.#client
        .prepare(`SELECT ${rulesetColumns} FROM match_rulesets WHERE version = ?`)
        .get(record.version) as RulesetRow | undefined;
      if (!row) throw new Error('Match ruleset persistence did not produce a row.');
      if (row.definition_hash !== record.definitionHash) {
        throw new TypeError(`Match ruleset version ${record.version} is immutable.`);
      }
      return ruleset(row);
    })();
  }

  public createOrGetMatch(record: MatchResultRecord): MatchResultRecord {
    this.#client
      .prepare(
        `INSERT INTO match_results
         (id, profile_version_id, job_revision_id, job_enrichment_id, ruleset_id,
          filter_status, total_score, components_json, risks_json, input_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(input_hash) DO NOTHING`,
      )
      .run(
        record.id,
        record.profileVersionId,
        record.jobRevisionId,
        record.jobEnrichmentId,
        record.rulesetId,
        record.filterStatus,
        record.totalScore,
        canonicalJson(record.components),
        canonicalJson(record.ruleOutcomes),
        record.inputHash,
        record.createdAt,
      );
    const row = this.#client
      .prepare(`SELECT ${matchColumns} FROM match_results WHERE input_hash = ?`)
      .get(record.inputHash) as MatchRow | undefined;
    if (!row) throw new Error('Match result persistence did not produce a row.');
    return match(row);
  }

  public getMatch(id: MatchResultRecord['id']): MatchResultRecord | null {
    const row = this.#client
      .prepare(`SELECT ${matchColumns} FROM match_results WHERE id = ?`)
      .get(id) as MatchRow | undefined;
    return row ? match(row) : null;
  }

  public saveAdvice(record: MatchAdviceRecord): MatchAdviceRecord {
    this.#client
      .prepare(
        `INSERT INTO match_advices
         (id, match_result_id, agent_run_id, schema_version, content_hash, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_result_id, agent_run_id) DO NOTHING`,
      )
      .run(
        record.id,
        record.matchResultId,
        record.agentRunId,
        record.schemaVersion,
        record.contentHash,
        canonicalJson(record.result),
        record.createdAt,
      );
    const row = this.#client
      .prepare(
        `SELECT ${adviceColumns} FROM match_advices
         WHERE match_result_id = ? AND agent_run_id = ?`,
      )
      .get(record.matchResultId, record.agentRunId) as AdviceRow | undefined;
    if (!row) throw new Error('Match advice persistence did not produce a row.');
    return advice(row);
  }

  public getAdvice(id: MatchAdviceRecord['id']): MatchAdviceRecord | null {
    const row = this.#client
      .prepare(`SELECT ${adviceColumns} FROM match_advices WHERE id = ?`)
      .get(id) as AdviceRow | undefined;
    return row ? advice(row) : null;
  }

  public getCurrentAdvice(
    matchResultId: Parameters<MatchingRepository['getCurrentAdvice']>[0],
    selector: Parameters<MatchingRepository['getCurrentAdvice']>[1],
  ): MatchAdviceRecord | null {
    const row = this.#client
      .prepare(
        `SELECT ma.id, ma.match_result_id, ma.agent_run_id, ma.schema_version,
                ma.content_hash, ma.result_json, ma.created_at
         FROM match_advices ma
         JOIN agent_runs ar ON ar.id = ma.agent_run_id
         WHERE ma.match_result_id = ? AND ar.status = 'succeeded'
           AND ar.agent_key = ? AND ar.agent_version = ?
           AND ar.prompt_version = ? AND ar.model_config_hash = ?
         ORDER BY ma.created_at DESC, ma.id DESC LIMIT 1`,
      )
      .get(
        matchResultId,
        selector.agentKey,
        selector.agentVersion,
        selector.promptVersion,
        selector.modelConfigHash,
      ) as AdviceRow | undefined;
    return row ? advice(row) : null;
  }

  public listCurrentProfileVersionIdsPage(
    input: Parameters<MatchingRepository['listCurrentProfileVersionIdsPage']>[0],
  ): ReturnType<MatchingRepository['listCurrentProfileVersionIdsPage']> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new TypeError('Profile version page limit is invalid.');
    }
    const rows = this.#client
      .prepare(
        `SELECT id FROM profile_versions
         WHERE is_current = 1 AND (? IS NULL OR id > ?)
         ORDER BY id ASC LIMIT ?`,
      )
      .all(input.afterId, input.afterId, input.limit) as { readonly id: string }[];
    return rows.map((row) => parseId(row.id, 'ProfileVersion'));
  }

  public listLatestRevisionIdsPage(
    input: Parameters<MatchingRepository['listLatestRevisionIdsPage']>[0],
  ): ReturnType<MatchingRepository['listLatestRevisionIdsPage']> {
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

  public listCurrentMatches(
    input: Parameters<MatchingRepository['listCurrentMatches']>[0],
  ): CurrentMatchPage {
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Current match page limit is invalid.');
    }
    const statuses: ('active' | 'stale' | 'closed')[] = ['active'];
    if (input.includeStale) statuses.push('stale');
    if (input.includeClosed) statuses.push('closed');
    const cursor = input.cursor ? decodeCurrentMatchCursor(input.cursor) : null;
    const statusPlaceholders = statuses.map(() => '?').join(', ');
    const cursorCondition = cursor
      ? `AND (total_score < ?
              OR (total_score = ? AND recency < ?)
              OR (total_score = ? AND recency = ? AND job_id > ?))`
      : '';
    const cursorParameters = cursor
      ? [cursor.score, cursor.score, cursor.recency, cursor.score, cursor.recency, cursor.jobId]
      : [];
    const rows = this.#client
      .prepare(
        `WITH current_profile AS (
           SELECT id FROM profile_versions WHERE profile_id = ? AND is_current = 1
         ),
         latest_revisions AS (
           SELECT r.id, r.job_id,
                  ROW_NUMBER() OVER (PARTITION BY r.job_id ORDER BY r.revision_no DESC) AS position
           FROM job_revisions r
         ),
         latest_enrichments AS (
           SELECT e.id, e.job_revision_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY e.job_revision_id ORDER BY e.created_at DESC, e.id DESC
                  ) AS position
           FROM job_enrichments e
         ),
         candidates AS (
           SELECT mr.id, mr.profile_version_id, mr.job_revision_id, mr.job_enrichment_id,
                  mr.ruleset_id, mr.filter_status, mr.total_score, mr.components_json,
                  mr.risks_json, mr.input_hash, mr.created_at,
                  j.id AS job_id, j.title, j.status AS job_status,
                  j.published_at, j.last_seen_at, rs.version AS ruleset_version,
                  COALESCE(j.published_at, j.last_seen_at) AS recency,
                  ROW_NUMBER() OVER (
                    PARTITION BY j.id
                    ORDER BY CASE WHEN mr.job_enrichment_id = le.id THEN 0 ELSE 1 END,
                             mr.created_at DESC, mr.id DESC
                  ) AS preference
           FROM match_results mr
           JOIN current_profile cp ON cp.id = mr.profile_version_id
           JOIN latest_revisions lr ON lr.id = mr.job_revision_id AND lr.position = 1
           JOIN jobs j ON j.id = lr.job_id
           JOIN match_rulesets rs ON rs.id = mr.ruleset_id AND rs.active = 1
           LEFT JOIN latest_enrichments le
             ON le.job_revision_id = lr.id AND le.position = 1
           WHERE (mr.job_enrichment_id = le.id OR mr.job_enrichment_id IS NULL)
         )
         SELECT * FROM candidates
         WHERE preference = 1
           AND job_status IN (${statusPlaceholders})
           ${input.includeExcluded ? '' : "AND filter_status <> 'excluded'"}
           ${cursorCondition}
         ORDER BY total_score DESC, recency DESC, job_id ASC
         LIMIT ?`,
      )
      .all(input.profileId, ...statuses, ...cursorParameters, limit + 1) as CurrentMatchRow[];
    const pageRows = rows.slice(0, limit);
    const items: CurrentMatchListItem[] = pageRows.map((row) => ({
      match: match(row),
      jobId: parseId(row.job_id, 'Job'),
      title: row.title,
      jobStatus: row.job_status,
      publishedAt: row.published_at === null ? null : utcInstant(row.published_at),
      lastSeenAt: utcInstant(row.last_seen_at),
      rulesetVersion: row.ruleset_version,
    }));
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCurrentMatchCursor(last) : null,
    };
  }
}
