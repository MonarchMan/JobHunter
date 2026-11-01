import type { MatchingJobReader } from '@jobhunter/recruitment/contracts/matching-jobs';
import type { MatchingProfileIdentityReader } from '@jobhunter/user/contracts';
import type { AgentRunReader } from '@jobhunter/common/agent';
import type {
  CurrentMatchListItem,
  CurrentMatchPage,
  JobEnrichmentRecord,
  MatchAdviceRecord,
  MatchingRepository,
  MatchingJobRevisionRecord,
  MatchResultRecord,
  MatchRulesetRecord,
} from '../ports/matching.js';
import {
  canonicalJson,
  parseContentHash,
  parseId,
  utcInstant,
  type JobId,
} from '@jobhunter/common/domain';
import { parseDeterministicMatchOutput } from '../model.js';
import { jobAdviceSchema } from '../contracts/job-advice.js';
import { parseJobUnderstanding } from '../job-understanding.js';
import { parseMatchRuleset } from '../rulesets.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/** 数据库查询结果对应的行结构。 */
interface EnrichmentRow {
  readonly id: string;
  readonly job_revision_id: string;
  readonly agent_run_id: string;
  readonly schema_version: string;
  readonly content_hash: string;
  readonly result_json: string;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
interface RulesetRow {
  readonly id: string;
  readonly version: string;
  readonly definition_json: string;
  readonly definition_hash: string;
  readonly active: number;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
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

/** 数据库查询结果对应的行结构。 */
interface AdviceRow {
  readonly id: string;
  readonly match_result_id: string;
  readonly agent_run_id: string;
  readonly schema_version: string;
  readonly content_hash: string;
  readonly result_json: string;
  readonly created_at: number;
}

/** 数据库查询结果对应的行结构。 */
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

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function encodeCurrentMatchCursor(row: CurrentMatchRow): string {
  return Buffer.from(
    JSON.stringify({ score: row.total_score, recency: row.recency, jobId: row.job_id }),
    'utf8',
  ).toString('base64url');
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function decodeCurrentMatchCursor(value: string): z.infer<typeof currentMatchCursorSchema> {
  try {
    return currentMatchCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
    );
  } catch (error) {
    throw new TypeError('Current match cursor is invalid.', { cause: error });
  }
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
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

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
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

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
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

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
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

/** 持久化匹配规则集、匹配结果和准备建议。 */
export class SqliteMatchingRepository implements MatchingRepository {
  readonly #client: Database.Database;

  public constructor(
    client: Database.Database,
    private readonly jobs: MatchingJobReader,
    private readonly profiles: MatchingProfileIdentityReader,
    private readonly agentRuns: AgentRunReader,
  ) {
    this.#client = client;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getRevision(id: MatchingJobRevisionRecord['id']): MatchingJobRevisionRecord | null {
    return this.jobs.getRevision(id);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getLatestRevisionForJob(jobId: JobId): MatchingJobRevisionRecord | null {
    return this.jobs.getLatestRevisionForJob(jobId);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getCompanyContext(
    companyId: Parameters<MatchingRepository['getCompanyContext']>[0],
  ): ReturnType<MatchingRepository['getCompanyContext']> {
    return this.jobs.getCompanyContext(companyId);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getEnrichment(id: JobEnrichmentRecord['id']): JobEnrichmentRecord | null {
    const row = this.#client
      .prepare(`SELECT ${enrichmentColumns} FROM job_enrichments WHERE id = ?`)
      .get(id) as EnrichmentRow | undefined;
    return row ? enrichment(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public getRuleset(id: MatchRulesetRecord['id']): MatchRulesetRecord | null {
    const row = this.#client
      .prepare(`SELECT ${rulesetColumns} FROM match_rulesets WHERE id = ?`)
      .get(id) as RulesetRow | undefined;
    return row ? ruleset(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getActiveRuleset(): MatchRulesetRecord | null {
    const row = this.#client
      .prepare(`SELECT ${rulesetColumns} FROM match_rulesets WHERE active = 1`)
      .get() as RulesetRow | undefined;
    return row ? ruleset(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public getMatch(id: MatchResultRecord['id']): MatchResultRecord | null {
    const row = this.#client
      .prepare(`SELECT ${matchColumns} FROM match_results WHERE id = ?`)
      .get(id) as MatchRow | undefined;
    return row ? match(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 执行数据库组件对外暴露的操作。 */
  public getAdvice(id: MatchAdviceRecord['id']): MatchAdviceRecord | null {
    const row = this.#client
      .prepare(`SELECT ${adviceColumns} FROM match_advices WHERE id = ?`)
      .get(id) as AdviceRow | undefined;
    return row ? advice(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getCurrentAdvice(
    matchResultId: Parameters<MatchingRepository['getCurrentAdvice']>[0],
    selector: Parameters<MatchingRepository['getCurrentAdvice']>[1],
  ): MatchAdviceRecord | null {
    // 1、建议候选仅来自匹配表；Agent 运行身份由通用只读端口校验。
    const rows = this.#client
      .prepare(
        'SELECT id, match_result_id, agent_run_id, schema_version, content_hash, result_json, created_at FROM match_advices WHERE match_result_id=? ORDER BY created_at DESC, id DESC',
      )
      .all(matchResultId) as AdviceRow[];
    for (const row of rows) {
      const run = this.agentRuns.get(row.agent_run_id);
      if (
        run?.status === 'succeeded' &&
        run.agentKey === selector.agentKey &&
        run.agentVersion === selector.agentVersion &&
        run.promptVersion === selector.promptVersion &&
        run.modelConfigHash === selector.modelConfigHash
      )
        return advice(row);
    }
    return null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listCurrentProfileVersionIdsPage(
    input: Parameters<MatchingRepository['listCurrentProfileVersionIdsPage']>[0],
  ): ReturnType<MatchingRepository['listCurrentProfileVersionIdsPage']> {
    return this.profiles.currentVersionIdsPage(input);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listLatestRevisionIdsPage(
    input: Parameters<MatchingRepository['listLatestRevisionIdsPage']>[0],
  ): ReturnType<MatchingRepository['listLatestRevisionIdsPage']> {
    return this.jobs.listLatestRevisionIdsPage(input);
  }

  /** 执行数据库组件对外暴露的操作。 */
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
    // 1、一次获取招聘事实快照，两个查询视图必须使用完全相同的输入。
    const jobFacts = JSON.stringify(this.jobs.listCurrentJobFacts());
    const rows = this.#client
      .prepare(
        `WITH current_profile AS (SELECT ? AS id),
         latest_revisions AS (SELECT json_extract(value,'$.revisionId') AS id, json_extract(value,'$.jobId') AS job_id, 1 AS position FROM json_each(?)),
         job_facts AS (SELECT json_extract(value,'$.jobId') AS id, json_extract(value,'$.title') AS title, json_extract(value,'$.status') AS status, json_extract(value,'$.publishedAt') AS published_at, json_extract(value,'$.lastSeenAt') AS last_seen_at FROM json_each(?)),
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
           JOIN job_facts j ON j.id = lr.job_id
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
      .all(
        this.profiles.currentVersionId(input.profileId),
        jobFacts,
        jobFacts,
        ...statuses,
        ...cursorParameters,
        limit + 1,
      ) as CurrentMatchRow[];
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
