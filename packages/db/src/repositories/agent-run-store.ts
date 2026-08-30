import {
  agentErrorCategories,
  type AgentErrorCategory,
  type AgentRunRecord,
  type AgentRunStore,
  type ToolCallRecord,
} from '@jobhunter/agent-core';
import type Database from 'better-sqlite3';

interface AgentRunRow {
  readonly id: string;
  readonly agent_key: string;
  readonly agent_version: string;
  readonly prompt_version: string;
  readonly model_config_hash: string;
  readonly input_hash: string;
  readonly cache_key: string;
  readonly status: string;
  readonly output_json: string | null;
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

const columns = `id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
                 cache_key, status, output_json, error_category, error_summary, input_tokens,
                 output_tokens, estimated_cost_micros, cost_currency, pricing_version,
                 started_at, finished_at`;

function isStatus(value: string): value is AgentRunRecord['status'] {
  return (
    value === 'running' || value === 'succeeded' || value === 'failed' || value === 'cancelled'
  );
}

function isCategory(value: string): value is AgentErrorCategory {
  return (agentErrorCategories as readonly string[]).includes(value);
}

function parseJson(value: string | null): unknown {
  return value === null ? null : (JSON.parse(value) as unknown);
}

function toRecord(row: AgentRunRow): AgentRunRecord {
  if (!isStatus(row.status)) throw new TypeError(`Invalid stored agent run status: ${row.status}.`);
  if (row.error_category !== null && !isCategory(row.error_category)) {
    throw new TypeError(`Invalid stored agent error category: ${row.error_category}.`);
  }
  return {
    id: row.id,
    agentKey: row.agent_key,
    agentVersion: row.agent_version,
    promptVersion: row.prompt_version,
    modelConfigHash: row.model_config_hash,
    inputHash: row.input_hash,
    cacheKey: row.cache_key,
    status: row.status,
    output: parseJson(row.output_json),
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostMicros: row.estimated_cost_micros,
    costCurrency: row.cost_currency,
    pricingVersion: row.pricing_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}

export class SqliteAgentRunStore implements AgentRunStore {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  public findSucceeded(cacheKey: string): AgentRunRecord | null {
    const row = this.#client
      .prepare(`SELECT ${columns} FROM agent_runs WHERE cache_key = ? AND status = 'succeeded'`)
      .get(cacheKey) as AgentRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  public get(id: string): AgentRunRecord | null {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    return row ? toRecord(row) : null;
  }

  public createRunning(record: AgentRunRecord): void {
    if (record.status !== 'running') throw new TypeError('New agent run must be running.');
    this.#client
      .prepare(
        `INSERT INTO agent_runs
           (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash,
            cache_key, status, cost_currency, pricing_version, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        record.id,
        record.agentKey,
        record.agentVersion,
        record.promptVersion,
        record.modelConfigHash,
        record.inputHash,
        record.cacheKey,
        record.costCurrency,
        record.pricingVersion,
        record.startedAt,
      );
  }

  public completeSucceeded(
    input: Parameters<AgentRunStore['completeSucceeded']>[0],
  ): ReturnType<AgentRunStore['completeSucceeded']> {
    try {
      const changed = this.#client
        .prepare(
          `UPDATE agent_runs
           SET status = 'succeeded', output_json = ?, input_tokens = ?, output_tokens = ?,
               estimated_cost_micros = ?, cost_currency = ?, pricing_version = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          JSON.stringify(input.output),
          input.usage.inputTokens,
          input.usage.outputTokens,
          input.usage.estimatedCostMicros,
          input.usage.costCurrency,
          input.usage.pricingVersion,
          input.finishedAt,
          input.id,
        );
      if (changed.changes !== 1) throw new TypeError('Agent run is not running.');
      return { kind: 'stored', record: this.#required(input.id) };
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      return this.#client.transaction(() => {
        const winner = this.findSucceeded(input.cacheKey);
        if (!winner) throw error;
        this.#client
          .prepare(
            `UPDATE agent_runs
             SET status = 'failed', error_category = 'cache_race_resolved',
                 error_summary = 'Equivalent successful run won cache race.',
                 input_tokens = ?, output_tokens = ?, estimated_cost_micros = ?,
                 cost_currency = ?, pricing_version = ?, finished_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .run(
            input.usage.inputTokens,
            input.usage.outputTokens,
            input.usage.estimatedCostMicros,
            input.usage.costCurrency,
            input.usage.pricingVersion,
            input.finishedAt,
            input.id,
          );
        return { kind: 'race', record: winner } as const;
      })();
    }
  }

  public completeFailed(input: Parameters<AgentRunStore['completeFailed']>[0]): AgentRunRecord {
    const changed = this.#client
      .prepare(
        `UPDATE agent_runs
         SET status = ?, error_category = ?, error_summary = ?, input_tokens = ?,
             output_tokens = ?, estimated_cost_micros = ?, cost_currency = ?,
             pricing_version = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        input.status,
        input.category,
        input.summary,
        input.usage.inputTokens,
        input.usage.outputTokens,
        input.usage.estimatedCostMicros,
        input.usage.costCurrency,
        input.usage.pricingVersion,
        input.finishedAt,
        input.id,
      );
    if (changed.changes !== 1) throw new TypeError('Agent run is not running.');
    return this.#required(input.id);
  }

  public saveToolCall(record: ToolCallRecord): void {
    this.#client
      .prepare(
        `INSERT INTO events
           (id, stream_type, stream_id, sequence_no, event_type, payload_json, occurred_at)
         SELECT ?, 'agent_run', ?, ?, 'agent.tool.finished', ?, started_at
         FROM agent_runs WHERE id = ?`,
      )
      .run(
        record.id,
        record.agentRunId,
        record.sequenceNo + 1,
        JSON.stringify({
          toolKey: record.toolKey,
          inputSummary: record.inputSummary,
          outputSummary: record.outputSummary,
          status: record.status,
          durationMs: record.durationMs,
          errorSummary: record.errorSummary,
        }),
        record.agentRunId,
      );
  }

  #required(id: string): AgentRunRecord {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    if (!row) throw new TypeError(`Agent run not found: ${id}.`);
    return toRecord(row);
  }
}
