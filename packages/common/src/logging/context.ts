import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogFields, LogLevel } from './contracts.js';

/** 业务仅依赖写事件端口；资源关闭始终属于组合根。 */
export interface LogWriter {
  debug?(event: string, fields?: LogFields): void;
  info(event: string, fields: LogFields): void;
  warn(event: string, fields: LogFields): void;
  error(event: string, fields: LogFields): void;
}
const context = new AsyncLocalStorage<{ fields: LogFields; logger?: LogWriter | undefined }>();

/** 沿异步调用链继承诊断身份，并隔离并行请求/任务。 */
export function withLogContext<T>(fields: LogFields, operation: () => T, logger?: LogWriter): T {
  const parent = context.getStore();
  return context.run(
    { fields: { ...parent?.fields, ...fields }, logger: logger ?? parent?.logger },
    operation,
  );
}
/** 读取当前日志字段，调用方不能修改存储。 */
export function currentLogFields(): LogFields {
  return context.getStore()?.fields ?? {};
}
/** 在已装配的执行作用域内记录业务事件，不创建隐式文件写入者。 */
export function logDiagnostic(level: LogLevel, event: string, fields: LogFields = {}): void {
  const current = context.getStore();
  current?.logger?.[level]?.(event, { ...current.fields, ...fields });
}
