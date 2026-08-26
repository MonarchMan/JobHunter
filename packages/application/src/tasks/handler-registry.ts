import type { RegisteredTaskHandler, TaskHandler, TaskHandlerContext } from './model.js';
import { TaskExecutionError } from './retry-policy.js';

export const voidTaskOutputSchema = {
  parse(value: unknown): void {
    if (value !== undefined) throw new TypeError('Task handler must not return a value.');
  },
};

function validateHandler(handler: RegisteredTaskHandler): void {
  if (!handler.taskType.trim()) throw new TypeError('Task type must not be empty.');
  if (!Number.isSafeInteger(handler.defaultMaxAttempts) || handler.defaultMaxAttempts < 1) {
    throw new TypeError(`Invalid default max attempts for task type: ${handler.taskType}`);
  }
  if (!Number.isSafeInteger(handler.leaseDurationMs) || handler.leaseDurationMs < 1_000) {
    throw new TypeError(`Invalid lease duration for task type: ${handler.taskType}`);
  }
}

export class HandlerRegistry {
  readonly #handlers = new Map<string, RegisteredTaskHandler>();

  public register<TPayload, TOutput>(handler: TaskHandler<TPayload, TOutput>): void {
    const erased = handler as RegisteredTaskHandler;
    validateHandler(erased);
    if (this.#handlers.has(handler.taskType)) {
      throw new TypeError(`Task handler is already registered: ${handler.taskType}`);
    }
    this.#handlers.set(handler.taskType, erased);
  }

  public get(taskType: string): RegisteredTaskHandler {
    const handler = this.#handlers.get(taskType);
    if (!handler) throw new TypeError(`Unknown task type: ${taskType}`);
    return handler;
  }

  public has(taskType: string): boolean {
    return this.#handlers.has(taskType);
  }

  public taskTypes(): readonly string[] {
    return [...this.#handlers.keys()];
  }

  public parsePayload(taskType: string, payload: unknown): unknown {
    return this.get(taskType).payloadSchema.parse(payload);
  }

  public concurrencyKey(taskType: string, payload: unknown): string | null {
    const handler = this.get(taskType);
    const parsed = handler.payloadSchema.parse(payload);
    const key = handler.concurrencyKey?.(parsed) ?? null;
    if (key !== null && !key.trim()) {
      throw new TypeError(`Task concurrency key must not be empty: ${taskType}`);
    }
    return key;
  }

  public async execute(
    taskType: string,
    context: TaskHandlerContext,
    payload: unknown,
  ): Promise<unknown> {
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
