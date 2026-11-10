import { sanitizeAgentErrorSummary } from '../agent/errors.js';
import { currentModelMessage } from '../agent/message-context.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  modelBillingSchema,
  modelRequestRecordSchema,
  type ModelBilling,
  type ModelRequestRecord,
} from '../contracts/model-usage.js';

/** 请求字段一一映射到列；单价快照独立 JSON，不重复存整份账单。 */
const fields = {
  requestedAt: 'requested_at',
  application: 'application',
  provider: 'provider',
  model: 'model',
  statusCode: 'status_code',
  transportError: 'transport_error',
  durationMs: 'duration_ms',
  firstTokenMs: 'first_token_ms',
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  uncachedInputTokens: 'uncached_input_tokens',
  cacheReadTokens: 'cache_read_tokens',
  cacheWriteTokens: 'cache_write_tokens',
  cacheWrite5mTokens: 'cache_write_5m_tokens',
  cacheWrite1hTokens: 'cache_write_1h_tokens',
  inputCostMicros: 'input_cost_micros',
  outputCostMicros: 'output_cost_micros',
  cacheReadCostMicros: 'cache_read_cost_micros',
  cacheWriteCostMicros: 'cache_write_cost_micros',
  cacheWrite5mCostMicros: 'cache_write_5m_cost_micros',
  cacheWrite1hCostMicros: 'cache_write_1h_cost_micros',
  totalCostMicros: 'total_cost_micros',
  currency: 'currency',
  pricingVersion: 'pricing_version',
  period: 'period',
  precision: 'precision',
} as const;
/** 从数据库边界重建已校验账单，生成速度由输出量与有效生成时间计算。 */
export function readModelRequest(
  value: unknown,
): ModelRequestRecord & { agentRunId: string | null; agentKey: string } {
  const row = z.record(z.string(), z.unknown()).parse(value);
  const values = Object.fromEntries(
    Object.entries(fields).map(([key, column]) => [
      key,
      row[column] == null && (key === 'application' || key === 'provider')
        ? undefined
        : row[column],
    ]),
  );
  const billing = modelBillingSchema.parse({
    ...values,
    requestId: row.id,
    ...(row.failure_reason == null ? {} : { failureReason: row.failure_reason }),
    rates:
      row.rates_json == null ? null : (JSON.parse(z.string().parse(row.rates_json)) as unknown),
  });
  const generation = (billing.durationMs ?? 0) - (billing.firstTokenMs ?? 0);
  billing.outputTokensPerSecond ??=
    billing.firstTokenMs != null && billing.outputTokens != null && generation > 0
      ? (billing.outputTokens * 1000) / generation
      : null;
  return {
    ...modelRequestRecordSchema.parse({ id: row.id, state: row.state, billing }),
    agentRunId: z.string().nullable().parse(row.agent_run_id),
    agentKey: z.string().parse(row.agent_key),
  };
}

/** 独立账本仓储；写入事务不包含网络，重复结束通知不产生新记录。 */
export class SqliteModelRequestRepository {
  public constructor(private readonly client: Database.Database) {}
  public listForRun(id: string): ModelBilling[] {
    return this.client
      .prepare(
        "SELECT request.*, json_extract(diagnostic.payload_json,'$.failureReason') AS failure_reason FROM model_requests request LEFT JOIN events diagnostic ON diagnostic.stream_type='model_request' AND diagnostic.stream_id=request.id AND diagnostic.sequence_no=1 AND diagnostic.event_type='model.request.failure' WHERE request.agent_run_id=? ORDER BY request.requested_at,request.rowid",
      )
      .all(id)
      .map((row) => readModelRequest(row).billing);
  }
  /** 请求与脱敏诊断同事务落库，重复用量更新不清除先前诊断。 */
  public save(agentRunId: string, input: ModelRequestRecord): void {
    this.client
      .transaction(() => {
        this.#save(agentRunId, input);
      })
      .immediate();
  }
  #save(agentRunId: string, input: ModelRequestRecord): void {
    const record = modelRequestRecordSchema.parse(input);
    if (record.billing.requestId && record.billing.requestId !== record.id)
      throw new TypeError('Request ID mismatch.');
    const columns = [...Object.values(fields), 'rates_json'];
    const entries = Object.keys(fields) as (keyof typeof fields)[];
    const values = [
      ...entries.map((key) => record.billing[key] ?? null),
      record.billing.rates === null ? null : JSON.stringify(record.billing.rates),
    ];
    // 1、开始时从仍存在的运行取得 Agent 快照；完成后允许原运行被清理，关联不复活。
    const existing = this.client
      .prepare('SELECT agent_run_id, agent_key, state FROM model_requests WHERE id = ?')
      .get(record.id) as
      { agent_run_id: string | null; agent_key: string; state: string } | undefined;
    if (existing?.agent_run_id && existing.agent_run_id !== agentRunId)
      throw new TypeError('Request belongs to another run.');
    if (existing?.state === 'completed' && record.state === 'running') return;
    const agent =
      existing?.agent_key ??
      this.client.prepare('SELECT agent_key FROM agent_runs WHERE id = ?').pluck().get(agentRunId);
    const agentKey = z.string().parse(agent);
    // 2、SQL 参数仅绑定数据；列名来自静态映射。请求身份、所属运行和 Agent 快照不可覆写。
    this.client
      .prepare(
        `INSERT INTO model_requests (id, agent_run_id, agent_key, state, ai_message_id, ${columns.join(',')})
      VALUES (?, ?, ?, ?, ?, ${columns.map(() => '?').join(',')})
      ON CONFLICT(id) DO UPDATE SET state = excluded.state, ${columns.map((column) => `${column} = excluded.${column}`).join(',')}`,
      )
      .run(
        record.id,
        existing ? existing.agent_run_id : agentRunId,
        agentKey,
        record.state,
        currentModelMessage() === null
          ? null
          : (this.client
              .prepare('SELECT id FROM ai_messages WHERE id=?')
              .pluck()
              .get(currentModelMessage()) ?? null),
        ...values,
      );
    if (record.billing.failureReason) {
      const failureReason = sanitizeAgentErrorSummary(record.billing.failureReason);
      this.client
        .prepare(
          "INSERT INTO events(id,stream_type,stream_id,sequence_no,event_type,payload_json,occurred_at) VALUES(?,'model_request',?,1,'model.request.failure',?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,occurred_at=excluded.occurred_at",
        )
        .run(
          `model-request-failure:${record.id}`,
          record.id,
          JSON.stringify({ failureReason }),
          record.billing.requestedAt + (record.billing.durationMs ?? 0),
        );
    }
  }
}
