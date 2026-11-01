import type { TaskId, UtcInstant } from '../shared/index.js';

/** 通用任务生命周期状态。 */
export const TASK_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 模块数据结构或契约。 */
export interface TaskIdentity {
  readonly id: TaskId;
  readonly taskType: string;
  readonly idempotencyKey: string | null;
  readonly concurrencyKey: string | null;
  readonly createdAt: UtcInstant;
}
