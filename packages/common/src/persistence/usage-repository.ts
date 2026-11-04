import type Database from 'better-sqlite3';
import { z } from 'zod';
import { modelBillingSchema } from '../contracts/model-usage.js';
import type { UsageCall, UsageRepository } from '../usage/service.js';

/** 从现有请求快照读取账本；不写数据库，不以运行开始时间截断重试调用。 */
export class SqliteUsageRepository implements UsageRepository {
  public constructor(private readonly client: Database.Database) {}
  public read(start: number, end: number): { calls: UsageCall[]; legacyRuns: number } {
    // 1、按真实 requestedAt 筛选每次调用，JSON 索引与 run ID 组成稳定身份。
    const rows = this.client
      .prepare(
        `SELECT run.id || ':' || item.key AS id, run.agent_key AS agent, run.status, item.value AS billing
      FROM agent_runs run, json_each(COALESCE(run.model_usage_json, '[]')) item
      WHERE json_extract(item.value, '$.requestedAt') >= ? AND json_extract(item.value, '$.requestedAt') < ?`,
      )
      .all(start, end);
    const schema = z.object({
      id: z.string(),
      agent: z.string(),
      status: z.string(),
      billing: z.string(),
    });
    const calls = rows.map((value) => {
      const row = schema.parse(value);
      return {
        ...modelBillingSchema.parse(JSON.parse(row.billing)),
        id: row.id,
        agent: row.agent,
        status: row.status,
      };
    });
    // 2、历史聚合无法还原请求数，独立提示，不与请求账本混算。
    const legacyRuns = z
      .number()
      .parse(
        this.client
          .prepare(
            `SELECT count(*) FROM agent_runs WHERE started_at >= ? AND started_at < ? AND (model_usage_json IS NULL OR json_array_length(model_usage_json) = 0) AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(output_tokens, 0) > 0)`,
          )
          .pluck()
          .get(start, end),
      );
    return { calls, legacyRuns };
  }
}
