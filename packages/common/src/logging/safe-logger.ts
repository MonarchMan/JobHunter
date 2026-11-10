import type { Logger } from 'pino';
import { currentLogFields } from './context.js';
import { redactLogValue } from './redaction.js';
import { boundLogFields } from './event-budget.js';

import type { LogFields, LogLevel, SafeLogger } from './contracts.js';
export type { LogFields, LogLevel, SafeLogger } from './contracts.js';

/** 基于 Pino 的安全日志实现。 */
export class PinoSafeLogger implements SafeLogger {
  readonly #logger: Logger;
  readonly #context: LogFields;
  readonly #close: () => Promise<void>;

  public constructor(
    logger: Logger,
    context: LogFields = {},
    close: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.#logger = logger;
    this.#context = context;
    this.#close = close;
  }

  /** 输出调试事件。 */
  public debug(event: string, fields: LogFields = {}): void {
    this.#write('debug', event, fields);
  }
  /** 输出信息事件。 */
  public info(event: string, fields: LogFields = {}): void {
    this.#write('info', event, fields);
  }
  /** 输出警告事件。 */
  public warn(event: string, fields: LogFields = {}): void {
    this.#write('warn', event, fields);
  }
  /** 输出错误事件。 */
  public error(event: string, fields: LogFields = {}): void {
    this.#write('error', event, fields);
  }

  /** 创建继承固定字段的子日志器。 */
  public child(fields: LogFields): SafeLogger {
    return new PinoSafeLogger(this.#logger, { ...this.#context, ...fields });
  }

  /** 刷新并关闭底层日志流。 */
  public async close(): Promise<void> {
    await this.#close();
  }

  #write(level: LogLevel, event: string, fields: LogFields): void {
    // 1、禁用事件不触发字段枚举或脱敏；2、诊断故障不能覆盖业务异常。
    if (!this.#logger.isLevelEnabled(level)) return;
    try {
      // 分别脱敏后才合并，避免对象展开触发外部输入的 getter。
      const safe: Record<string, unknown> = {
        ...(redactLogValue(this.#context) as LogFields),
        ...(redactLogValue(currentLogFields()) as LogFields),
        ...(redactLogValue(fields) as LogFields),
      };
      // envelope 只能由运行时生成，业务字段不能伪造级别、时间和进程身份。
      for (const key of ['level', 'time', 'pid', 'threadId', 'msg', 'event', 'schemaVersion'])
        Reflect.deleteProperty(safe, key);
      const safeEvent = String(redactLogValue(event)).slice(0, 256);
      const bounded = boundLogFields(safe);
      this.#logger[level]({ ...bounded, event: safeEvent, schemaVersion: 1 }, safeEvent);
    } catch {
      try {
        this.#logger.error(
          { event: 'logging.serialization_failed', schemaVersion: 1 },
          '日志序列化失败',
        );
      } catch {
        /* 输出失败不能改变业务结果。 */
      }
    }
  }
}
