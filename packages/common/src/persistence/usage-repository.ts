import type Database from 'better-sqlite3';
import { z } from 'zod';
import { readModelRequest } from './model-request-repository.js';
import type { UsageCall, UsageRepository } from '../usage/service.js';

/** 从现有请求快照读取账本；不写数据库，不以运行开始时间截断重试调用。 */
export class SqliteUsageRepository implements UsageRepository {
  public constructor(private readonly client: Database.Database) {}
  public read(start: number, end: number): { calls: UsageCall[]; legacyRuns: number } {
    // 1、索引按真实请求时间扫描；LEFT JOIN 保留运行已被清理的历史账单。
    const rows = this.client
      .prepare(
        `SELECT request.*, run.status AS run_status, json_extract(diagnostic.payload_json,'$.failureReason') AS failure_reason
      FROM model_requests request LEFT JOIN agent_runs run ON run.id = request.agent_run_id
      LEFT JOIN events diagnostic ON diagnostic.stream_type='model_request' AND diagnostic.stream_id=request.id AND diagnostic.sequence_no=1 AND diagnostic.event_type='model.request.failure'
      WHERE request.requested_at >= ? AND request.requested_at < ?`,
      )
      .all(start, end);
    const calls = rows.map((value) => {
      const row = readModelRequest(value);
      return {
        ...row.billing,
        id: row.id,
        agent: row.agentKey,
        status:
          z.object({ run_status: z.string().nullable() }).parse(value).run_status ?? 'deleted',
        requestState: row.state,
      };
    });
    // 2、历史聚合无法还原请求数，独立提示，不与请求账本混算。
    const legacyRuns = z
      .number()
      .parse(
        this.client
          .prepare(
            `SELECT count(*) FROM agent_runs run WHERE started_at >= ? AND started_at < ? AND NOT EXISTS (SELECT 1 FROM model_requests request WHERE request.agent_run_id = run.id) AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(output_tokens, 0) > 0)`,
          )
          .pluck()
          .get(start, end),
      );
    return { calls, legacyRuns };
  }
}
