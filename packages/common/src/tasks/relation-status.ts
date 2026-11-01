import type { TaskStatus } from './model.js';

/** 只读取任务与业务身份关联的最新执行状态，不暴露任务 payload。 */
export interface TaskRelationStatusReader {
  latest(taskType: string, field: string, value: string): TaskStatus | null;
}
