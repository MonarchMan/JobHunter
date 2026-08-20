import type { TaskId, UtcInstant } from '../shared/index.js';

export const TASK_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskIdentity {
  readonly id: TaskId;
  readonly taskType: string;
  readonly idempotencyKey: string | null;
  readonly concurrencyKey: string | null;
  readonly createdAt: UtcInstant;
}
