import {
  webAgentRunDetailSchema,
  webAgentRunSummarySchema,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebDiagnosticsRepository,
} from '@jobhunter/application/web';
import type Database from 'better-sqlite3';

interface AgentRunRow {
  readonly id: string;
  readonly agent_key: string;
  readonly agent_version: string;
  readonly prompt_version: string;
  readonly model_config_hash: string;
  readonly status: WebAgentRunSummary['status'];
  readonly error_category: string | null;
  readonly error_summary: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly estimated_cost_micros: number | null;
  readonly cost_currency: string | null;
  readonly pricing_version: string | null;
  readonly started_at: number;
  readonly finished_at: number | null;
}

interface ToolCallRow {
  readonly sequence_no: number;
  readonly tool_key: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly duration_ms: number | null;
  readonly error_summary: string | null;
}

const columns = `id, agent_key, agent_version, prompt_version, model_config_hash, status,
  error_category, error_summary, input_tokens, output_tokens, estimated_cost_micros,
  cost_currency, pricing_version, started_at, finished_at`;

function summary(row: AgentRunRow): WebAgentRunSummary {
  return webAgentRunSummarySchema.parse({
    id: row.id,
    agentKey: row.agent_key,
    agentVersion: row.agent_version,
    promptVersion: row.prompt_version,
    modelConfigHash: row.model_config_hash,
    status: row.status,
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostMicros: row.estimated_cost_micros,
    costCurrency: row.cost_currency,
    pricingVersion: row.pricing_version,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
  });
}

export class SqliteWebDiagnosticsRepository implements WebDiagnosticsRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public listAgentRuns(limit: number): readonly WebAgentRunSummary[] {
    const rows = this.#client
      .prepare(`SELECT ${columns} FROM agent_runs ORDER BY started_at DESC, id ASC LIMIT ?`)
      .all(limit) as AgentRunRow[];
    return rows.map(summary);
  }

  public getAgentRun(id: string): WebAgentRunDetail | null {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    if (!row) return null;
    const calls = this.#client
      .prepare(
        `SELECT sequence_no, tool_key, status, duration_ms, error_summary
         FROM agent_tool_calls WHERE agent_run_id = ? ORDER BY sequence_no`,
      )
      .all(id) as ToolCallRow[];
    return webAgentRunDetailSchema.parse({
      ...summary(row),
      toolCalls: calls.map((call) => ({
        sequenceNumber: call.sequence_no,
        toolKey: call.tool_key,
        status: call.status,
        durationMs: call.duration_ms,
        errorSummary: call.error_summary,
      })),
    });
  }
}
