import type { RegisteredTaskHandler, TaskHandler, TaskHandlerContext } from './model.js';
import { TaskExecutionError } from './retry-policy.js';

/** 不允许返回结果的任务使用的输出校验器。 */
export const voidTaskOutputSchema = {
  parse(value: unknown): void {
    if (value !== undefined) throw new TypeError('Task handler must not return a value.');
  },
};

/** 校验处理器类型、重试次数和租约时长。 */
function validateHandler(handler: RegisteredTaskHandler): void {
  if (!handler.taskType.trim()) throw new TypeError('Task type must not be empty.');
  if (!Number.isSafeInteger(handler.defaultMaxAttempts) || handler.defaultMaxAttempts < 1) {
    throw new TypeError(`Invalid default max attempts for task type: ${handler.taskType}`);
  }
  if (!Number.isSafeInteger(handler.leaseDurationMs) || handler.leaseDurationMs < 1_000) {
    throw new TypeError(`Invalid lease duration for task type: ${handler.taskType}`);
  }
}

/** 任务处理器注册表，集中负责 payload/output 校验和并发键计算。 */
export class HandlerRegistry {
  readonly #handlers = new Map<string, RegisteredTaskHandler>();

  public register<TPayload, TOutput>(handler: TaskHandler<TPayload, TOutput>): void {
    // 1、擦除泛型后校验元数据，再拒绝重复任务类型。
    const erased = handler as RegisteredTaskHandler;
    validateHandler(erased);
    if (this.#handlers.has(handler.taskType)) {
      throw new TypeError(`Task handler is already registered: ${handler.taskType}`);
    }
    this.#handlers.set(handler.taskType, erased);
  }

  /** 按任务类型读取处理器，不存在时立即失败。 */
  public get(taskType: string): RegisteredTaskHandler {
    const handler = this.#handlers.get(taskType);
    if (!handler) throw new TypeError(`Unknown task type: ${taskType}`);
    return handler;
  }

  /** 判断任务类型是否已经注册。 */
  public has(taskType: string): boolean {
    return this.#handlers.has(taskType);
  }

  /** 返回所有已注册任务类型。 */
  public taskTypes(): readonly string[] {
    return [...this.#handlers.keys()];
  }

  /** 使用处理器 Schema 解析存储的任务参数。 */
  public parsePayload(taskType: string, payload: unknown): unknown {
    return this.get(taskType).payloadSchema.parse(payload);
  }

  /** 解析 payload 后计算并校验任务并发键。 */
  public concurrencyKey(taskType: string, payload: unknown): string | null {
    const handler = this.get(taskType);
    const parsed = handler.payloadSchema.parse(payload);
    const key = handler.concurrencyKey?.(parsed) ?? null;
    if (key !== null && !key.trim()) {
      throw new TypeError(`Task concurrency key must not be empty: ${taskType}`);
    }
    return key;
  }

  /** 执行应用组件对外暴露的操作。 */
  public async execute(
    taskType: string,
    context: TaskHandlerContext,
    payload: unknown,
  ): Promise<unknown> {
    // 1、先校验持久化 payload，再执行处理器并校验返回值。
    const handler = this.get(taskType);
    let parsedPayload: unknown;
    try {
      parsedPayload = handler.payloadSchema.parse(payload);
    } catch (error) {
      throw new TaskExecutionError('validation_failed', 'Stored task payload is invalid.', {
        cause: error,
      });
    }
    const output = await handler.execute(context, parsedPayload);
    try {
      return handler.outputSchema.parse(output);
    } catch (error) {
      throw new TaskExecutionError('validation_failed', 'Task output validation failed.', {
        cause: error,
      });
    }
  }
}
