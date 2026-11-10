/** 日志事件的安全字段及四级严重程度；外部值由输出边界再次脱敏。 */
export type LogFields = Readonly<Record<string, unknown>>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 通用日志端口；child 继承字段但不拥有关闭底层输出的权限。 */
export interface SafeLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): SafeLogger;
  close(): Promise<void>;
}
