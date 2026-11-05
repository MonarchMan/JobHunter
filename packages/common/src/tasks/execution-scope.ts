import { AsyncLocalStorage } from 'node:async_hooks';

/** 一次分派的执行身份；重试必须生成新的 owner，不能复用进程身份。 */
export interface TaskExecutionIdentity {
  readonly taskId: string;
  readonly owner: string;
  readonly attempt: number;
  readonly now: () => number;
}

const execution = new AsyncLocalStorage<TaskExecutionIdentity>();

/** 在处理器异步调用链中传递执行身份，不污染其他任务或入口请求。 */
export function withTaskExecution<T>(identity: TaskExecutionIdentity, operation: () => T): T {
  return execution.run(identity, operation);
}

/** 仓储适配器读取当前身份；普通 HTTP/CLI 写入没有任务执行身份。 */
export function currentTaskExecution(): TaskExecutionIdentity | undefined {
  return execution.getStore();
}
