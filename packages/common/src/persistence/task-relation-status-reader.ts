import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { TaskRelationStatusReader } from '../tasks/relation-status.js';

/** 通用任务关联状态查询；业务模块通过端口读取，不直接访问任务表。 */
export class SqliteTaskRelationStatusReader implements TaskRelationStatusReader {
  public constructor(private readonly client: Database.Database) {}

  public latest(
    taskType: string,
    field: string,
    value: string,
  ): ReturnType<TaskRelationStatusReader['latest']> {
    // 1、限制 JSON 字段为单层标识符，并将路径与值全部作为参数绑定。
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new TypeError('Invalid relation field.');
    const row = this.client
      .prepare(
        'SELECT status FROM tasks WHERE task_type = ? AND json_extract(private_state, ?) = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      )
      .get(taskType, `$.${field}`, value) as { status: unknown } | undefined;
    // 2、没有关联任务表示尚未请求；已有任务严格校验状态。
    return row
      ? z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']).parse(row.status)
      : null;
  }
}
