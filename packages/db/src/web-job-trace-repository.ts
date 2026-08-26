import type { WebJobDetail, WebJobTrace, WebJobTraceRepository } from '@jobhunter/application/web';
import { jobAdviceSchema, ruleOutcomeSchema, scoreComponentSchema } from '@jobhunter/matching';
import type Database from 'better-sqlite3';
import { z } from 'zod';

interface RevisionRow {
  readonly id: string;
  readonly revision_no: number;
  readonly change_set_json: string;
  readonly created_at: number;
}

interface MatchRow {
  readonly id: string;
  readonly profile_version_id: string;
  readonly filter_status: 'eligible' | 'excluded' | 'uncertain';
  readonly total_score: number;
  readonly components_json: string;
  readonly risks_json: string;
  readonly ruleset_version: string;
  readonly created_at: number;
  readonly advice_json: string | null;
  readonly advice_task_status: string | null;
}

const storedChangeSetSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(
    z
      .object({
        field: z.string(),
        before: z.unknown(),
        after: z.unknown(),
      })
      .strict(),
  ),
]);

function parseChanges(source: string): Record<string, unknown> {
  const changeSet = storedChangeSetSchema.parse(JSON.parse(source) as unknown);
  if (!Array.isArray(changeSet)) return changeSet;
  return Object.fromEntries(
    changeSet.map((change) => [change.field, { before: change.before, after: change.after }]),
  );
}

function advice(row: MatchRow): WebJobDetail['matches'][number]['advice'] {
  if (row.advice_json) {
    return {
      status: 'available',
      content: jobAdviceSchema.parse(JSON.parse(row.advice_json) as unknown),
    };
  }
  if (row.advice_task_status === 'pending' || row.advice_task_status === 'running')
    return { status: 'pending' };
  if (row.advice_task_status === 'failed') return { status: 'failed' };
  return { status: 'not_requested' };
}

export class SqliteWebJobTraceRepository implements WebJobTraceRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public get(jobId: string): WebJobTrace {
    const revisions = this.#client
      .prepare(
        `SELECT id, revision_no, change_set_json, created_at
         FROM job_revisions WHERE job_id = ?
         ORDER BY revision_no DESC`,
      )
      .all(jobId) as RevisionRow[];
    const matches = this.#client
      .prepare(
        `WITH latest_revision AS (
           SELECT id FROM job_revisions WHERE job_id = ? ORDER BY revision_no DESC LIMIT 1
         ), candidates AS (
           SELECT mr.*, rs.version AS ruleset_version,
                  ROW_NUMBER() OVER (
                    PARTITION BY mr.profile_version_id ORDER BY mr.created_at DESC, mr.id DESC
                  ) AS preference
           FROM match_results mr
           JOIN latest_revision lr ON lr.id = mr.job_revision_id
           JOIN profile_versions pv ON pv.id = mr.profile_version_id AND pv.is_current = 1
           JOIN match_rulesets rs ON rs.id = mr.ruleset_id
         )
         SELECT c.id, c.profile_version_id, c.filter_status, c.total_score, c.components_json,
                c.risks_json, c.ruleset_version, c.created_at,
                (SELECT ma.result_json FROM match_advices ma
                 WHERE ma.match_result_id = c.id ORDER BY ma.created_at DESC, ma.id DESC LIMIT 1)
                  AS advice_json,
                (SELECT t.status FROM tasks t
                 WHERE t.task_type = 'match.advise'
                   AND json_extract(t.payload_json, '$.matchResultId') = c.id
                 ORDER BY t.created_at DESC, t.id DESC LIMIT 1) AS advice_task_status
         FROM candidates c WHERE c.preference = 1
         ORDER BY c.total_score DESC, c.created_at DESC`,
      )
      .all(jobId) as MatchRow[];
    return {
      revisions: revisions.map((row) => ({
        id: row.id,
        revisionNumber: row.revision_no,
        changes: parseChanges(row.change_set_json),
        createdAt: new Date(row.created_at).toISOString(),
      })),
      matches: matches.map((row) => ({
        id: row.id,
        profileVersionId: row.profile_version_id,
        filterStatus: row.filter_status,
        totalScore: row.total_score,
        components: z.array(scoreComponentSchema).parse(JSON.parse(row.components_json) as unknown),
        ruleOutcomes: z.array(ruleOutcomeSchema).parse(JSON.parse(row.risks_json) as unknown),
        rulesetVersion: row.ruleset_version,
        createdAt: new Date(row.created_at).toISOString(),
        advice: advice(row),
      })),
    };
  }
}
