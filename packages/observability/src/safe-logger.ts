import type { Logger } from 'pino';
import { redactLogValue } from './redaction.js';

export type LogFields = Readonly<Record<string, unknown>>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SafeLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): SafeLogger;
  close(): Promise<void>;
}

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

  public debug(event: string, fields: LogFields = {}): void {
    this.#write('debug', event, fields);
  }
  public info(event: string, fields: LogFields = {}): void {
    this.#write('info', event, fields);
  }
  public warn(event: string, fields: LogFields = {}): void {
    this.#write('warn', event, fields);
  }
  public error(event: string, fields: LogFields = {}): void {
    this.#write('error', event, fields);
  }

  public child(fields: LogFields): SafeLogger {
    return new PinoSafeLogger(this.#logger, { ...this.#context, ...fields }, this.#close);
  }

  public async close(): Promise<void> {
    await this.#close();
  }

  #write(level: LogLevel, event: string, fields: LogFields): void {
    const safe = redactLogValue({ ...this.#context, ...fields }) as LogFields;
    this.#logger[level](safe, event);
  }
}
