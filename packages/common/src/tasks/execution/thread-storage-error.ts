import { z } from 'zod';
import { hasNonRetryableAgentError } from '../../agent/errors.js';
import { sqliteMaintenanceMessage } from '../../persistence/maintenance-gate.js';

/** 仅传递驱动错误代码或固定维护标识，不传递 SQL、参数、原始正文及堆栈。 */
export const threadStorageFailureSchema = z.union([
  z.string().regex(/^SQLITE_[A-Z0-9_]{1,64}$/u),
  z.literal(sqliteMaintenanceMessage),
]);

/** 从有界异常链中保留存储分类；业务包装错误不能遮蔽锁忙及维护拒写。 */
export function threadStorageFailure(error: unknown): string | undefined {
  if (hasNonRetryableAgentError(error)) return undefined;
  const seen = new Set<Error>();
  while (error instanceof Error && seen.size < 16 && !seen.has(error)) {
    if (error.message === sqliteMaintenanceMessage) return sqliteMaintenanceMessage;
    if (
      'code' in error &&
      typeof error.code === 'string' &&
      threadStorageFailureSchema.safeParse(error.code).success
    )
      return error.code;
    seen.add(error);
    error = error.cause;
  }
  return undefined;
}

/** 用固定摘要重建原因对象，复用宿主既有的锁忙检测及安全日志链。 */
export function restoreThreadStorageFailure(
  code: string | undefined,
  diagnostic?: unknown,
): Error | undefined {
  if (code === undefined) return undefined;
  const validated = threadStorageFailureSchema.parse(code);
  if (validated === sqliteMaintenanceMessage)
    return new Error(sqliteMaintenanceMessage, { cause: diagnostic });
  return Object.assign(
    new Error(`SQLite operation failed (${validated}).`, { cause: diagnostic }),
    {
      name: 'SqliteError',
      code: validated,
    },
  );
}
