import type { Logger } from 'pino';
import { redactLogValue } from './redaction.js';

/** 模块使用的类型约束。 */
export type LogFields = Readonly<Record<string, unknown>>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 模块数据结构或契约。 */
export interface SafeLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): SafeLogger;
  close(): Promise<void>;
}

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
    return new PinoSafeLogger(this.#logger, { ...this.#context, ...fields }, this.#close);
  }

  /** 刷新并关闭底层日志流。 */
  public async close(): Promise<void> {
    await this.#close();
  }

  #write(level: LogLevel, event: string, fields: LogFields): void {
    const safe = redactLogValue({ ...this.#context, ...fields }) as LogFields;
    this.#logger[level](safe, event);
  }
}
