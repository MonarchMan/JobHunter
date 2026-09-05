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
