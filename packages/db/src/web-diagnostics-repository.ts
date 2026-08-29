import {
  webAgentRunDetailSchema,
  webAgentRunSummarySchema,
  webSourceSyncTaskDetailSchema,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebDiagnosticsRepository,
  type WebSourceSyncTaskDetail,
  type WebTaskListEntry,
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

interface TaskEntryRow {
  readonly kind: 'task' | 'source_job_detail_batch';
  readonly id: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
  readonly cancel_requested: number;
  readonly company_name: string | null;
  readonly channel: 'intern' | 'campus' | 'social' | null;
  readonly source_slug: string | null;
  readonly total: number | null;
  readonly pending: number | null;
  readonly running: number | null;
  readonly succeeded: number | null;
  readonly failed: number | null;
  readonly cancelled: number | null;
}

const taskEntriesCte = `
  WITH RECURSIVE detail_roots(task_id, root_id) AS (
    SELECT task.id, task.id FROM tasks task
    WHERE task.task_type = 'source.job-detail' AND task.retry_of_task_id IS NULL
    UNION ALL
    SELECT child.id, parent.root_id
    FROM tasks child
    JOIN detail_roots parent ON child.retry_of_task_id = parent.task_id
    WHERE child.task_type = 'source.job-detail'
  ),
  detail_ranked AS (
    SELECT task.*,
           ROW_NUMBER() OVER (
             PARTITION BY json_extract(task.payload_json, '$.runId'),
                          json_extract(task.payload_json, '$.sourceId'),
                          COALESCE(root.root_id, task.id)
             ORDER BY task.created_at DESC, task.id DESC
           ) AS retry_rank
    FROM tasks task
    LEFT JOIN detail_roots root ON root.task_id = task.id
    WHERE task.task_type = 'source.job-detail'
      AND json_type(task.payload_json, '$.runId') = 'text'
      AND json_type(task.payload_json, '$.sourceId') = 'text'
  ),
  detail_groups AS (
    SELECT json_extract(task.payload_json, '$.runId') AS run_id,
           json_extract(task.payload_json, '$.sourceId') AS source_id,
           MIN(task.created_at) AS created_at,
           MIN(task.started_at) AS started_at,
           CASE WHEN SUM(CASE WHEN task.status IN ('pending', 'running') THEN 1 ELSE 0 END) = 0
                THEN MAX(task.finished_at) ELSE NULL END AS finished_at,
           MAX(CASE WHEN task.cancel_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS cancel_requested,
           COUNT(*) AS total,
           SUM(CASE WHEN task.status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN task.status = 'running' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN task.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
           SUM(CASE WHEN task.status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN task.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM detail_ranked task
    WHERE task.retry_rank = 1
    GROUP BY run_id, source_id
  ),
  batch_entries AS (
    SELECT 'source_job_detail_batch' AS kind, detail.run_id AS id,
           'source.job-detail' AS task_type,
           CASE WHEN detail.running > 0 THEN 'running'
                WHEN detail.pending > 0 THEN 'pending'
                WHEN detail.failed > 0 THEN 'failed'
                WHEN detail.cancelled = detail.total THEN 'cancelled'
                WHEN detail.cancelled > 0 THEN 'cancelled'
                ELSE 'succeeded' END AS status,
           detail.created_at, detail.started_at, detail.finished_at, detail.cancel_requested,
           company.name AS company_name, channel.channel, source.slug AS source_slug,
           detail.total, detail.pending, detail.running, detail.succeeded,
           detail.failed, detail.cancelled
    FROM detail_groups detail
    JOIN job_sources source ON source.id = detail.source_id
    JOIN companies company ON company.id = source.company_id
    JOIN source_channels channel ON channel.id = source.channel_id
  ),
  task_entries AS (
    SELECT 'task' AS kind, task.id, task.task_type, task.status, task.created_at,
           task.started_at, task.finished_at,
           CASE WHEN task.cancel_requested_at IS NULL THEN 0 ELSE 1 END AS cancel_requested,
           NULL AS company_name, NULL AS channel, NULL AS source_slug,
           NULL AS total, NULL AS pending, NULL AS running, NULL AS succeeded,
           NULL AS failed, NULL AS cancelled
    FROM tasks task WHERE task.task_type != 'source.job-detail'
    UNION ALL
    SELECT * FROM batch_entries
  )`;

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

  public listTaskEntries(input: {
    readonly status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    readonly taskType?: string;
    readonly limit: number;
    readonly offset: number;
  }): { readonly items: readonly WebTaskListEntry[]; readonly total: number } {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (input.status) {
      conditions.push('status = ?');
      parameters.push(input.status);
    }
    if (input.taskType) {
      conditions.push('task_type = ?');
      parameters.push(input.taskType);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = this.#client
      .prepare(`${taskEntriesCte} SELECT COUNT(*) AS total FROM task_entries ${where}`)
      .get(...parameters) as { readonly total: number };
    const rows = this.#client
      .prepare(
        `${taskEntriesCte}
         SELECT kind, id, status, created_at, started_at, finished_at, cancel_requested,
                company_name, channel, source_slug, total, pending, running, succeeded,
                failed, cancelled
         FROM task_entries ${where}
         ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, input.limit, input.offset) as TaskEntryRow[];
    return {
      total: count.total,
      items: rows.map((row): WebTaskListEntry => {
        if (row.kind === 'task') return { kind: 'task', taskId: row.id };
        if (
          !row.company_name ||
          !row.channel ||
          !row.source_slug ||
          row.total === null ||
          row.pending === null ||
          row.running === null ||
          row.succeeded === null ||
          row.failed === null ||
          row.cancelled === null
        ) {
          throw new TypeError('Source job detail batch projection is incomplete.');
        }
        return {
          kind: row.kind,
          id: row.id,
          status: row.status,
          createdAt: row.created_at,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          cancelRequested: row.cancel_requested === 1,
          batch: {
            runId: row.id,
            companyName: row.company_name,
            channel: row.channel,
            sourceSlug: row.source_slug,
            counts: {
              total: row.total,
              pending: row.pending,
              running: row.running,
              succeeded: row.succeeded,
              failed: row.failed,
              cancelled: row.cancelled,
            },
          },
        };
      }),
    };
  }

  public listAgentRuns(input: { readonly limit: number; readonly offset: number }): {
    readonly items: readonly WebAgentRunSummary[];
    readonly total: number;
  } {
    const count = this.#client.prepare('SELECT COUNT(*) AS total FROM agent_runs').get() as {
      readonly total: number;
    };
    const requestedPage = Math.floor(input.offset / input.limit) + 1;
    const totalPages = Math.max(1, Math.ceil(count.total / input.limit));
    const offset = (Math.min(requestedPage, totalPages) - 1) * input.limit;
    const rows = this.#client
      .prepare(
        `SELECT ${columns} FROM agent_runs ORDER BY started_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(input.limit, offset) as AgentRunRow[];
    return { items: rows.map(summary), total: count.total };
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

  public getSourceSyncTaskDetail(input: {
    readonly sourceId: string;
    readonly trigger: 'manual' | 'schedule' | 'retry';
    readonly windowStartedAt: number;
    readonly windowFinishedAt: number | null;
  }): WebSourceSyncTaskDetail | null {
    const row = this.#client
      .prepare(
        `SELECT company.name AS company_name, channel.channel, source.slug AS source_slug,
                source.adapter_key, run.id AS run_id, run.status AS run_status,
                run.coverage, run.stats_json, run.error_category, run.error_summary
         FROM job_sources source
         JOIN companies company ON company.id = source.company_id
         JOIN source_channels channel ON channel.id = source.channel_id
         LEFT JOIN sync_runs run ON run.id = (
           SELECT candidate.id FROM sync_runs candidate
           WHERE candidate.source_id = source.id
             AND candidate.started_at >= ?
             AND (? IS NULL OR candidate.started_at <= ?)
           ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
         )
         WHERE source.id = ?`,
      )
      .get(
        input.windowStartedAt,
        input.windowFinishedAt,
        input.windowFinishedAt,
        input.sourceId,
      ) as
      | {
          readonly company_name: string;
          readonly channel: WebSourceSyncTaskDetail['channel'];
          readonly source_slug: string;
          readonly adapter_key: string;
          readonly run_id: string | null;
          readonly run_status: NonNullable<WebSourceSyncTaskDetail['run']>['status'] | null;
          readonly coverage: NonNullable<WebSourceSyncTaskDetail['run']>['coverage'] | null;
          readonly stats_json: string | null;
          readonly error_category: string | null;
          readonly error_summary: string | null;
        }
      | undefined;
    if (!row) return null;
    return webSourceSyncTaskDetailSchema.parse({
      companyName: row.company_name,
      channel: row.channel,
      sourceSlug: row.source_slug,
      adapterKey: row.adapter_key,
      trigger: input.trigger,
      run:
        row.run_id && row.run_status && row.coverage
          ? {
              id: row.run_id,
              status: row.run_status,
              coverage: row.coverage,
              stats: JSON.parse(row.stats_json ?? '{}') as unknown,
              errorCategory: row.error_category,
              errorSummary: row.error_summary,
            }
          : null,
    });
  }
}
