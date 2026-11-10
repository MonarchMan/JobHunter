import type { ModelRequestRecord } from '../contracts/model-usage.js';
import { SqliteModelRequestRepository } from './model-request-repository.js';
import {
  agentErrorCategories,
  type AgentErrorCategory,
  type AgentRunRecord,
  type AgentRunStore,
  type AgentRunCostCorrectionStore,
  type ToolCallRecord,
} from '@jobhunter/common/agent';
import type Database from 'better-sqlite3';

/** 数据库查询结果对应的行结构。 */
interface AgentRunRow {
  readonly id: string;
  readonly agent_key: string;
  readonly task_id: string | null;
  readonly step_key: string | null;
  readonly resource_key: string | null;
  readonly definition_hash: string;
  readonly model_config_hash: string;
  readonly input_hash: string;
  readonly cache_key: string;
  readonly status: string;
  readonly output_json: string | null;
  readonly output_hash: string | null;
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

const columns = `id, agent_key, definition_hash, model_config_hash, input_hash,
                 cache_key, status, output_json, output_hash, error_category, error_summary, input_tokens,
                 output_tokens, estimated_cost_micros, cost_currency, pricing_version,
                 started_at, finished_at, task_id, step_key, resource_key`;

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function isStatus(value: string): value is AgentRunRecord['status'] {
  return (
    value === 'running' || value === 'succeeded' || value === 'failed' || value === 'cancelled'
  );
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function isCategory(value: string): value is AgentErrorCategory {
  return (agentErrorCategories as readonly string[]).includes(value);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function parseJson(value: string | null): unknown {
  return value === null ? null : (JSON.parse(value) as unknown);
}

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function toRecord(row: AgentRunRow): AgentRunRecord {
  if (!isStatus(row.status)) throw new TypeError(`Invalid stored agent run status: ${row.status}.`);
  if (row.error_category !== null && !isCategory(row.error_category)) {
    throw new TypeError(`Invalid stored agent error category: ${row.error_category}.`);
  }
  return {
    id: row.id,
    ...(row.task_id && row.step_key && row.resource_key
      ? { execution: { taskId: row.task_id, stepKey: row.step_key, resourceKey: row.resource_key } }
      : {}),
    agentKey: row.agent_key,
    definitionHash: row.definition_hash,
    modelConfigHash: row.model_config_hash,
    inputHash: row.input_hash,
    cacheKey: row.cache_key,
    status: row.status,
    output: parseJson(row.output_json),
    outputHash: row.output_hash,
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

/** 执行数据库结果的解析、转换或持久化辅助逻辑。 */
function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}

/** 保存 Agent 运行状态、缓存键和输出摘要。 */
export class SqliteAgentRunStore implements AgentRunStore, AgentRunCostCorrectionStore {
  readonly #client: Database.Database;
  readonly #requests: SqliteModelRequestRepository;

  public constructor(client: Database.Database) {
    this.#client = client;
    this.#requests = new SqliteModelRequestRepository(client);
  }

  /** 运行只承担关联入口；请求事实由独立仓储保存。 */
  public saveModelRequest(agentRunId: string, record: ModelRequestRecord): void {
    this.#requests.save(agentRunId, record);
  }

  /** 兼容未实现流式观测的调用方；稳定身份使完成通知不会重复记账。 */
  #saveUsage(id: string, usage: Parameters<AgentRunStore['completeFailed']>[0]['usage']): void {
    for (const [index, billing] of (usage.billingCalls ?? []).entries()) {
      this.#requests.save(id, {
        id: billing.requestId ?? `run:${id}:${String(index)}`,
        state: 'completed',
        billing,
      });
    }
  }

  /** 明细与 ID 数组来自关联查询，运行表没有请求数组列。 */
  #toRecord(row: AgentRunRow): AgentRunRecord {
    const billingCalls = this.#requests.listForRun(row.id);
    return {
      ...toRecord(row),
      billingCalls,
      requestIds: billingCalls.flatMap((call) => (call.requestId ? [call.requestId] : [])),
    };
  }

  /** 仅回填已完成的未定价记录，不覆盖已有金额或修改运行输出。 */
  public backfillUnpricedCost(
    input: Parameters<AgentRunCostCorrectionStore['backfillUnpricedCost']>[0],
  ): boolean {
    // 1、维护输入必须为合法微单位金额与 Token 数，价格版本记录计算依据。
    const { usage } = input;
    if (
      ![input.startedAt, usage.inputTokens, usage.outputTokens, usage.estimatedCostMicros].every(
        (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
      ) ||
      !['USD', 'CNY'].includes(usage.costCurrency) ||
      !usage.pricingVersion.trim() ||
      usage.pricingVersion === 'unpriced'
    )
      throw new TypeError('Invalid cost correction.');
    // 2、在单条条件更新内核对时间和用量；重复回填或并发变化均不生效。
    return (
      this.#client
        .prepare(
          `UPDATE agent_runs
      SET estimated_cost_micros = ?, cost_currency = ?, pricing_version = ?
      WHERE id = ? AND started_at = ? AND input_tokens = ? AND output_tokens = ?
        AND status IN ('succeeded', 'failed', 'cancelled')
        AND pricing_version = 'unpriced' AND estimated_cost_micros IS NULL`,
        )
        .run(
          usage.estimatedCostMicros,
          usage.costCurrency,
          usage.pricingVersion,
          input.id,
          input.startedAt,
          usage.inputTokens,
          usage.outputTokens,
        ).changes === 1
    );
  }

  /** 执行数据库组件对外暴露的操作。 */
  public findSucceeded(cacheKey: string): AgentRunRecord | null {
    const row = this.#client
      .prepare(`SELECT ${columns} FROM agent_runs WHERE cache_key = ? AND status = 'succeeded'`)
      .get(cacheKey) as AgentRunRow | undefined;
    return row ? this.#toRecord(row) : null;
  }

  /** 执行数据库组件对外暴露的操作。 */
  public get(id: string): AgentRunRecord | null {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    return row ? this.#toRecord(row) : null;
  }

  /** 1、仅失效仍为成功的记录，保留原始输出、时间与用量，不覆盖并发失败状态。 */
  public invalidateSucceeded(id: string): void {
    this.#client
      .prepare(
        `UPDATE agent_runs SET status = 'failed', error_category = 'invalid_output',
      error_summary = 'Cached output failed validation.' WHERE id = ? AND status = 'succeeded'`,
      )
      .run(id);
  }

  /** 执行数据库组件对外暴露的操作。 */
  public restartFailed(cacheKey: string, startedAt: number): AgentRunRecord | null {
    return this.#client
      .transaction(() => {
        // 1、中央领取事务已关闭遗留调用；Runner 只恢复终态，绝不抢占活跃调用。
        const row = this.#client
          .prepare(
            `SELECT ${columns} FROM agent_runs WHERE cache_key = ? AND status IN ('failed','cancelled') ORDER BY started_at DESC LIMIT 1`,
          )
          .get(cacheKey) as AgentRunRow | undefined;
        if (!row) return null;
        this.#client
          .prepare(
            `UPDATE agent_runs SET status = 'running', started_at = ?, finished_at = NULL, error_category = NULL, error_summary = NULL, output_json = NULL, output_hash = NULL WHERE id = ?`,
          )
          .run(startedAt, row.id);
        const record = this.#toRecord(row);
        if (record.inputTokens !== null || record.outputTokens !== null) return record;
        // 2、崩溃可能发生在请求账单已落库、运行合计未提交之间，先从账本还原旧轮次用量。
        const calls = record.billingCalls ?? [];
        return {
          ...record,
          inputTokens: calls.reduce((total, call) => total + (call.inputTokens ?? 0), 0),
          outputTokens: calls.reduce((total, call) => total + (call.outputTokens ?? 0), 0),
          estimatedCostMicros: calls.some((call) => call.totalCostMicros === null)
            ? null
            : calls.reduce((total, call) => total + (call.totalCostMicros ?? 0), 0),
        };
      })
      .immediate();
  }

  /** 使用全历史工具序号，避免重试与旧调用唯一键冲突。 */
  public nextToolSequence(agentRunId: string): number {
    return this.#client
      .prepare(
        "SELECT COALESCE(MAX(sequence_no), 0) FROM events WHERE stream_type = 'agent_run' AND stream_id = ?",
      )
      .pluck()
      .get(agentRunId) as number;
  }

  /** 登记首次运行；重试由 restartFailed 保留原身份。 */
  public createRunning(record: AgentRunRecord): void {
    if (record.status !== 'running') throw new TypeError('New agent run must be running.');
    this.#client
      .prepare(
        `INSERT INTO agent_runs
           (id, agent_key, definition_hash, model_config_hash, input_hash,
            cache_key, status, cost_currency, pricing_version, started_at, task_id, step_key, resource_key)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.agentKey,
        record.definitionHash,
        record.modelConfigHash,
        record.inputHash,
        record.cacheKey,
        record.costCurrency,
        record.pricingVersion,
        record.startedAt,
        record.execution?.taskId ?? null,
        record.execution?.stepKey ?? null,
        record.execution?.resourceKey ?? null,
      );
  }

  /** 执行数据库组件对外暴露的操作。 */
  public completeSucceeded(
    input: Parameters<AgentRunStore['completeSucceeded']>[0],
  ): ReturnType<AgentRunStore['completeSucceeded']> {
    this.#saveUsage(input.id, input.usage);
    try {
      const changed = this.#client
        .prepare(
          `UPDATE agent_runs
           SET cache_key = ?, status = 'succeeded', output_json = ?, output_hash = ?, input_tokens = ?, output_tokens = ?,
               estimated_cost_micros = ?, cost_currency = ?, pricing_version = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          input.cacheKey,
          input.output === null ? null : JSON.stringify(input.output),
          input.outputHash,
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

  /** 执行数据库组件对外暴露的操作。 */
  public completeFailed(input: Parameters<AgentRunStore['completeFailed']>[0]): AgentRunRecord {
    this.#saveUsage(input.id, input.usage);
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

  /** 执行数据库组件对外暴露的操作。 */
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

  /** 处理数据库类内部的辅助逻辑。 */
  #required(id: string): AgentRunRecord {
    const row = this.#client.prepare(`SELECT ${columns} FROM agent_runs WHERE id = ?`).get(id) as
      AgentRunRow | undefined;
    if (!row) throw new TypeError(`Agent run not found: ${id}.`);
    return this.#toRecord(row);
  }
}
