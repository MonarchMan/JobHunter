/** 数据库模块使用的类型约束。 */
export type PersistenceErrorCode =
  | 'ARTIFACT_PATH_INVALID'
  | 'DATABASE_CAPABILITY_MISSING'
  | 'DATABASE_INTEGRITY_ERROR'
  | 'DATABASE_OPEN_FAILED'
  | 'SETTING_NOT_ALLOWED';

/** 数据库层统一错误，避免向上层泄露驱动细节。 */
export class PersistenceError extends Error {
  public readonly code: PersistenceErrorCode;
  public override readonly cause: unknown;

  public constructor(code: PersistenceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PersistenceError';
    this.code = code;
    this.cause = cause;
  }
}
