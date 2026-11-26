import { scanTaskProjection } from './scan-task-sql.js';
import { presentBatchProgress } from '../diagnostics/task-progress.js';
import {
  webAgentRunDetailSchema,
  webTaskSchema,
  type WebTask,
  webAgentRunSummarySchema,
  webSourceSyncTaskDetailSchema,
  type WebAgentRunDetail,
  type WebAgentRunSummary,
  type WebSourceSyncTaskDetail,
} from '@jobhunter/recruitment/contracts/web';
import type {
  WebDiagnosticsRepository,
  WebTaskListEntry,
} from '../diagnostics/web-diagnostics-service.js';
import type Database from 'better-sqlite3';
import { SqliteModelRequestRepository } from '@jobhunter/common/persistence/model-request-repository';

/** 数据库查询结果对应的行结构。 */
interface AgentRunRow {
  readonly id: string;
  readonly agent_key: string;
  readonly definition_hash: string;
  readonly model_config_hash: string;
  readonly status: WebAgentRunSummary['status'];
  readonly error_category: string | null;
  readonly error_summary: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly estimated_cost_micros: number | null;
  readonly cost_currency: string | null;
  readonly pricing_version: string | null;
  readonly has_unpriced_requests: number | null;
  readonly known_cost_micros: number | null;
  readonly started_at: number;
  readonly finished_at: number | null;
}

/** 数据库查询结果对应的行结构。 */
interface ToolCallRow {
  readonly sequence_no: number;
  readonly tool_key: string;
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly duration_ms: number | null;
  readonly error_summary: string | null;
}

const columns = `id, agent_key, definition_hash, model_config_hash, status,
  error_category, error_summary, input_tokens, output_tokens, estimated_cost_micros,
  cost_currency, pricing_version, started_at, finished_at,
  CASE WHEN EXISTS(SELECT 1 FROM model_requests r WHERE r.agent_run_id = agent_runs.id)
  THEN EXISTS(SELECT 1 FROM model_requests r WHERE r.agent_run_id = agent_runs.id
    AND r.state = 'completed' AND r.precision = 'unpriced'
    AND (r.input_tokens > 0 OR r.output_tokens > 0 OR r.cache_read_tokens > 0 OR r.cache_write_tokens > 0))
  END AS has_unpriced_requests,
  (SELECT CASE WHEN COUNT(*) = COUNT(CASE WHEN r.currency = agent_runs.cost_currency THEN 1 END)
    THEN SUM(r.total_cost_micros) END FROM model_requests r WHERE r.agent_run_id = agent_runs.id
    AND r.state = 'completed' AND r.total_cost_micros IS NOT NULL) AS known_cost_micros`;

/** 数据库查询结果对应的行结构。 */
interface TaskEntryRow {
  readonly attempt_count: number | null;
  readonly kind: 'task' | 'source_job_detail_batch' | null;
  readonly id: string | null;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null;
  readonly created_at: number | null;
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
  readonly result_total: number;
}

/** 列表聚合全部批次；按运行 ID 读取时先限制子任务范围。 */
const taskEntriesCte = (singleBatch: boolean): string => `
  WITH detail_tasks AS (
    SELECT task.id, task.status, task.created_at, task.started_at, task.finished_at,
           task.cancel_requested_at, task.attempt_count,
           task.source_run_id AS run_id,
           task.source_id
    FROM tasks task
    WHERE task.task_type = 'source.job-detail'
      AND task.source_run_id ${singleBatch ? '= ?' : 'IS NOT NULL'}
      AND task.source_id IS NOT NULL
  ),
  detail_groups AS (
    SELECT task.run_id, task.source_id,
           MIN(task.created_at) AS created_at,
           MIN(task.started_at) AS started_at,
           CASE WHEN SUM(CASE WHEN task.status IN ('pending', 'running') THEN 1 ELSE 0 END) = 0
                THEN MAX(task.finished_at) ELSE NULL END AS finished_at,
           MAX(CASE WHEN task.cancel_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS cancel_requested,
           MAX(task.attempt_count) AS attempt_count,
           COUNT(*) AS total,
           SUM(CASE WHEN task.status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN task.status = 'running' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN task.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
           SUM(CASE WHEN task.status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN task.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM detail_tasks task
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
           detail.failed, detail.cancelled, detail.attempt_count
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
           NULL AS failed, NULL AS cancelled, task.attempt_count
    FROM tasks task WHERE ${singleBatch ? 'FALSE' : "task.task_type NOT IN ('source.job-detail', 'source.scan')"}
    UNION ALL
    SELECT * FROM batch_entries
  )`;

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function summary(
  row: AgentRunRow,
  billingCalls?: NonNullable<WebAgentRunSummary['billingCalls']>,
): WebAgentRunSummary {
  return webAgentRunSummarySchema.parse({
    id: row.id,
    agentKey: row.agent_key,
    definitionHash: row.definition_hash,
    modelConfigHash: row.model_config_hash,
    status: row.status,
    errorCategory: row.error_category,
    errorSummary: row.error_summary,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostMicros: row.estimated_cost_micros,
    costCurrency: row.cost_currency,
    pricingVersion: row.pricing_version,
    ...(row.has_unpriced_requests === null
      ? {}
      : { hasUnpricedRequests: row.has_unpriced_requests === 1 }),
    knownCostMicros: row.known_cost_micros,
    billingCalls: billingCalls ?? null,
    ...(billingCalls
      ? { requestIds: billingCalls.flatMap((call) => (call.requestId ? [call.requestId] : [])) }
      : {}),
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
  });
}

/** 只关联当前尝试的扫描；终态仅可显式引用本次确认的已提交扫描。 */
const currentScan = `
  task.started_at IS NOT NULL
  AND task.status <> 'pending'
  AND (candidate.parent_task_id = task.id OR candidate.parent_task_id IS NULL)
  AND (
    (candidate.parent_task_id = task.id AND candidate.parent_attempt = task.attempt_count)
    OR (candidate.parent_attempt IS NULL AND candidate.started_at >= task.started_at
      AND (task.finished_at IS NULL OR candidate.started_at <= task.finished_at))
    OR (task.status IN ('succeeded', 'failed', 'cancelled')
      AND candidate.status IN ('succeeded', 'partial')
      AND (candidate.id = json_extract(task.public_state, '$.runId')
        OR EXISTS (
          SELECT 1 FROM json_each(task.public_state, '$.runs') result
          WHERE result.type = 'object' AND json_extract(result.value, '$.runId') = candidate.id
        )))
  )`;

/** 为 Web 诊断页提供任务、Agent 运行和工具调用只读详情。 */
export class SqliteWebDiagnosticsRepository implements WebDiagnosticsRepository {
  readonly #client: Database.Database;

  public constructor(client: Database.Database) {
    this.#client = client;
  }

  /** 当前页普通任务一次关联来源和同步运行，仅投影 WebTask 所需安全字段。 */
  public getTaskDetails(ids: readonly string[]): readonly WebTask[] {
    // 1、空页无需访问数据库；ID 通过 JSON 参数绑定，避免动态拼接用户输入。
    if (ids.length === 0) return [];
    const rows = this.#client
      .prepare(
        `
      SELECT task.private_state, task.public_state, json_object(
        'kind', 'task', 'id', task.id, 'taskType', task.task_type, 'status', task.status,
        'attemptCount', task.attempt_count,
        'errorCategory', CASE WHEN task.status NOT IN ('pending', 'running') THEN task.error_category END,
        'errorSummary', CASE WHEN task.status NOT IN ('pending', 'running') THEN task.error_summary END,
        'cancelRequested', json(CASE WHEN task.cancel_requested_at IS NULL THEN 'false' ELSE 'true' END),
        'createdAt', strftime('%Y-%m-%dT%H:%M:%fZ', task.created_at / 1000.0, 'unixepoch'),
        'startedAt', CASE WHEN task.status <> 'pending' THEN
          strftime('%Y-%m-%dT%H:%M:%fZ', task.started_at / 1000.0, 'unixepoch') END,
        'finishedAt', CASE WHEN task.status NOT IN ('pending', 'running') THEN
          strftime('%Y-%m-%dT%H:%M:%fZ', task.finished_at / 1000.0, 'unixepoch') END,
        'jobDetailBatch', NULL,
        'syncScoring', CASE WHEN task.task_type = 'source.sync' AND task.status <> 'pending' AND
            json_type(task.public_state, '$.scoring') = 'object' THEN
          json_extract(task.public_state, '$.scoring') ELSE NULL END,
        'sourceSync', CASE WHEN source.id IS NULL THEN NULL ELSE json_object(
          'companyName', company.name, 'channel', channel.channel,
          'sourceSlug', source.slug, 'adapterKey', source.adapter_key,
          'trigger', json_extract(task.private_state, '$.trigger'),
          'run', CASE WHEN run.id IS NULL THEN NULL ELSE json_object(
            'id', run.id, 'status', run.status, 'coverage', run.coverage,
            'stats', json(run.stats_json), 'errorCategory', run.error_category,
            'errorSummary', run.error_summary
          ) END
        ) END
      ) AS detail_json
      FROM tasks task
      LEFT JOIN job_sources source ON task.task_type = 'source.sync'
        AND source.id = COALESCE(task.source_id, json_extract(task.private_state, '$.sourceIds[0]'))
        AND json_extract(task.private_state, '$.trigger') IN ('manual', 'schedule', 'retry')
      LEFT JOIN companies company ON company.id = source.company_id
      LEFT JOIN source_channels channel ON channel.id = source.channel_id
      LEFT JOIN ${scanTaskProjection} run ON run.id = (
        SELECT candidate.id FROM ${scanTaskProjection} candidate
        WHERE candidate.source_id = source.id
          AND ${currentScan}
        ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
      )
      WHERE task.id IN (SELECT value FROM json_each(?))
    `,
      )
      .all(JSON.stringify(ids)) as {
      readonly detail_json: string;
      readonly private_state: string;
      readonly public_state: string | null;
    }[];
    // 2、与单任务详情共用运行时校验，阻止原始执行数据进入页面。
    return rows.map((row) => {
      const payload = JSON.parse(row.private_state) as { readonly sourceIds?: unknown };
      const detail = JSON.parse(row.detail_json) as Record<string, unknown>;
      const task = webTaskSchema.parse({
        ...detail,
        batchProgress: presentBatchProgress(
          String(detail.taskType),
          payload,
          detail.status !== 'pending' && row.public_state
            ? (JSON.parse(row.public_state) as unknown)
            : null,
        ),
      });
      if (!task.sourceSync || !Array.isArray(payload.sourceIds)) return task;
      const sourceIds = payload.sourceIds.filter((id): id is string => typeof id === 'string');
      if (sourceIds.length < 2) return task;
      const trigger = task.sourceSync.trigger;
      const sources = sourceIds.flatMap((sourceId) => {
        const detail = this.#getSourceSyncTaskDetail({
          taskId: task.id,
          sourceId,
          trigger,
        });
        return detail ? [detail] : [];
      });
      return webTaskSchema.parse({ ...task, sourceSync: { ...task.sourceSync, sources } });
    });
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listTaskEntries(input: {
    readonly batchRunId?: string;
    readonly since?: number;
    readonly before?: number;
    readonly status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'warning';
    readonly taskType?: string;
    readonly limit: number;
    readonly offset: number;
  }): { readonly items: readonly WebTaskListEntry[]; readonly total: number } {
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (input.batchRunId !== undefined) {
      conditions.push("kind = 'source_job_detail_batch' AND id = ?");
      parameters.push(input.batchRunId);
    }
    if (input.since !== undefined) {
      conditions.push('created_at >= ?');
      parameters.push(input.since);
    }
    if (input.before !== undefined) {
      conditions.push('created_at < ?');
      parameters.push(input.before);
    }
    if (input.status) {
      conditions.push('status = ?');
      parameters.push(input.status === 'warning' ? 'succeeded' : input.status);
      // 与详情使用同一来源范围和最新扫描顺序，旧尝试的失败不影响本次状态。
      if (input.status === 'warning' || input.status === 'succeeded') {
        conditions.push(`
          ${input.status === 'succeeded' ? 'NOT ' : ''}EXISTS (
            SELECT 1 FROM tasks task
            JOIN json_each(COALESCE(json_extract(task.private_state, '$.sourceIds'),
                                    json_array(task.source_id))) source
            JOIN job_sources official ON official.id = source.value
            JOIN ${scanTaskProjection} run ON run.id = (
              SELECT candidate.id FROM ${scanTaskProjection} candidate
              WHERE candidate.source_id = official.id
                AND ${currentScan}
              ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
            )
            WHERE task_entries.kind = 'task' AND task.id = task_entries.id
              AND task.task_type = 'source.sync'
              AND json_extract(task.private_state, '$.trigger') IN ('manual', 'schedule', 'retry')
              AND run.status <> 'running'
              AND (run.status IN ('partial', 'failed') OR run.coverage <> 'complete')
          )
        `);
      }
    }
    if (input.taskType) {
      conditions.push('task_type = ?');
      parameters.push(input.taskType);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // 1、物化筛选结果，避免总数和当前页分别重算详情任务的重试链与批次。
    // 2、从同一物化结果读取总数和分页；左连接保证空页仍返回总数供应用层回落。
    const rows = this.#client
      .prepare(
        `${taskEntriesCte(input.batchRunId !== undefined)}
         , filtered_entries AS MATERIALIZED (
           SELECT * FROM task_entries ${where}
         ),
         entry_count AS (
           SELECT COUNT(*) AS result_total FROM filtered_entries
         ),
         page_entries AS (
           SELECT * FROM filtered_entries
           ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?
         )
         SELECT page.kind, page.id, page.status, page.created_at, page.started_at,
                page.finished_at, page.cancel_requested, page.company_name, page.channel,
                page.source_slug, page.total, page.pending, page.running, page.succeeded,
                page.failed, page.cancelled, page.attempt_count, count.result_total
         FROM entry_count count
         LEFT JOIN page_entries page ON TRUE
         ORDER BY page.created_at DESC, page.id ASC`,
      )
      .all(
        ...(input.batchRunId === undefined ? [] : [input.batchRunId]),
        ...parameters,
        input.limit,
        input.offset,
      ) as TaskEntryRow[];
    const total = rows[0]?.result_total ?? 0;
    return {
      total,
      items: rows.flatMap((row): readonly WebTaskListEntry[] => {
        if (row.kind === null) return [];
        if (!row.id || !row.status || row.created_at === null) {
          throw new TypeError('Task projection is incomplete.');
        }
        if (row.kind === 'task') return [{ kind: 'task', taskId: row.id }];
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
        return [
          {
            kind: row.kind,
            id: row.id,
            status: row.status,
            attemptCount: row.attempt_count ?? 0,
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
          },
        ];
      }),
    };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public listAgentRuns(input: {
    readonly limit: number;
    readonly offset: number;
    readonly since?: number;
    readonly before?: number;
  }): {
    readonly items: readonly WebAgentRunSummary[];
    readonly total: number;
  } {
    const conditions: string[] = [];
    const parameters: number[] = [];
    if (input.since !== undefined) {
      conditions.push('started_at >= ?');
      parameters.push(input.since);
    }
    if (input.before !== undefined) {
      conditions.push('started_at < ?');
      parameters.push(input.before);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = this.#client
      .prepare(`SELECT COUNT(*) AS total FROM agent_runs ${where}`)
      .get(...parameters) as {
      readonly total: number;
    };
    const requestedPage = Math.floor(input.offset / input.limit) + 1;
    const totalPages = Math.max(1, Math.ceil(count.total / input.limit));
    const offset = (Math.min(requestedPage, totalPages) - 1) * input.limit;
    const rows = this.#client
      .prepare(
        `SELECT ${columns} FROM agent_runs ${where} ORDER BY started_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...parameters, input.limit, offset) as AgentRunRow[];
    return { items: rows.map((row) => summary(row)), total: count.total };
  }

  /** 执行数据库组件对外暴露的操作。 */
  public getAgentRun(id: string): WebAgentRunDetail | null {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    if (!row) return null;
    const calls = this.#client
      .prepare(
        `SELECT sequence_no,
                json_extract(payload_json, '$.toolKey') AS tool_key,
                json_extract(payload_json, '$.status') AS status,
                json_extract(payload_json, '$.durationMs') AS duration_ms,
                json_extract(payload_json, '$.errorSummary') AS error_summary
         FROM events
         WHERE stream_type = 'agent_run' AND stream_id = ?
           AND event_type = 'agent.tool.finished'
         ORDER BY sequence_no`,
      )
      .all(id) as ToolCallRow[];
    return webAgentRunDetailSchema.parse({
      ...summary(row, new SqliteModelRequestRepository(this.#client).listForRun(id)),
      toolCalls: calls.map((call) => ({
        sequenceNumber: call.sequence_no,
        toolKey: call.tool_key,
        status: call.status,
        durationMs: call.duration_ms,
        errorSummary: call.error_summary,
      })),
    });
  }

  /** 读取聚合任务的单个来源，沿用列表与单来源详情的扫描资格。 */
  #getSourceSyncTaskDetail(input: {
    readonly taskId: string;
    readonly sourceId: string;
    readonly trigger: 'manual' | 'schedule' | 'retry';
  }): WebSourceSyncTaskDetail | null {
    const row = this.#client
      .prepare(
        `SELECT company.name AS company_name, channel.channel, source.slug AS source_slug,
                source.adapter_key, run.id AS run_id, run.status AS run_status,
                run.coverage, run.stats_json, run.error_category, run.error_summary
         FROM tasks task
         JOIN job_sources source ON source.id = ?
         JOIN companies company ON company.id = source.company_id
         JOIN source_channels channel ON channel.id = source.channel_id
         LEFT JOIN ${scanTaskProjection} run ON run.id = (
           SELECT candidate.id FROM ${scanTaskProjection} candidate
           WHERE candidate.source_id = source.id
             AND ${currentScan}
           ORDER BY candidate.started_at DESC, candidate.id DESC LIMIT 1
         )
         WHERE task.id = ?`,
      )
      .get(input.sourceId, input.taskId) as
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
