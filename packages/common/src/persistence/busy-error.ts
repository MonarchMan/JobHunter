import { isSqliteMaintenanceError } from './maintenance-gate.js';

/** 仅识别驱动明确报告的锁冲突，其他数据库错误不得被无限重试掩盖。 */
export function isSqliteBusyError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (
      'code' in error &&
      typeof error.code === 'string' &&
      /^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(error.code)
    )
      return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}

/** 识别需要由任务租约恢复的 SQLite 暂时不可写状态。 */
export function isSqliteUnavailableError(error: unknown): boolean {
  // 1、驱动锁冲突与显式维护写保护都不是业务永久失败，统一交给 Worker 恢复。
  return isSqliteBusyError(error) || isSqliteMaintenanceError(error);
}
