/** 来源适配器使用的类型约束。 */
export type SourceErrorCategory =
  | 'temporary'
  | 'rate_limited'
  | 'not_found'
  | 'access_blocked'
  | 'parse_changed'
  | 'invalid_config';

/** 清理诊断信息中的凭据并限制长度。 */
function redactDiagnostic(value: string): string {
  return value
    .replaceAll(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replaceAll(/(cookie|token|password|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240);
}

/** 来源适配器统一错误，携带安全诊断和重试时间。 */
export class SourceError extends Error {
  public readonly category: SourceErrorCategory;
  public readonly safeDiagnostic: string;
  public readonly retryAfterAt: number | null;
  public override readonly cause: unknown;

  /** 执行来源组件对外暴露的操作。 */
  public constructor(
    category: SourceErrorCategory,
    diagnostic: string,
    options: { readonly retryAfterAt?: number; readonly cause?: unknown } = {},
  ) {
    const safeDiagnostic = redactDiagnostic(diagnostic) || 'Source operation failed.';
    super(safeDiagnostic);
    this.name = 'SourceError';
    this.category = category;
    this.safeDiagnostic = safeDiagnostic;
    this.retryAfterAt = options.retryAfterAt ?? null;
    this.cause = options.cause;
  }
}

/** 判断异常是否为来源统一错误。 */
export function isSourceError(error: unknown): error is SourceError {
  return error instanceof SourceError;
}
