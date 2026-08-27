import type {
  ResumePolishSuggestionRecord,
  ResumePolishSuggestionRepository,
} from '@jobhunter/application';
import { resumePolishAgentOutputSchema, resumePolishSectionSchema } from '@jobhunter/resume';
import type Database from 'better-sqlite3';

interface SuggestionRow {
  readonly id: string;
  readonly profile_id: string;
  readonly source_version_id: string;
  readonly sections_json: string;
  readonly result_json: string;
  readonly agent_run_id: string;
  readonly created_at: number;
}

export class SqliteResumePolishSuggestionRepository implements ResumePolishSuggestionRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public get(id: string): ResumePolishSuggestionRecord | null {
    const row = this.#client
      .prepare(
        `SELECT id, profile_id, source_version_id, sections_json, result_json, agent_run_id,
                created_at
           FROM resume_polish_suggestions
          WHERE id = ?`,
      )
      .get(id) as SuggestionRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      profileId: row.profile_id,
      sourceVersionId: row.source_version_id,
      sections: resumePolishSectionSchema.array().parse(JSON.parse(row.sections_json) as unknown),
      result: resumePolishAgentOutputSchema.parse(JSON.parse(row.result_json) as unknown),
      agentRunId: row.agent_run_id,
      createdAt: row.created_at,
    };
  }

  public save(record: ResumePolishSuggestionRecord): void {
    this.#client
      .prepare(
        `INSERT INTO resume_polish_suggestions
           (id, profile_id, source_version_id, sections_json, result_json, agent_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sections_json = excluded.sections_json,
           result_json = excluded.result_json,
           agent_run_id = excluded.agent_run_id,
           created_at = excluded.created_at`,
      )
      .run(
        record.id,
        record.profileId,
        record.sourceVersionId,
        JSON.stringify(record.sections),
        JSON.stringify(record.result),
        record.agentRunId,
        record.createdAt,
      );
  }
}
