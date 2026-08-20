export type SourceErrorCategory =
  | 'temporary'
  | 'rate_limited'
  | 'not_found'
  | 'access_blocked'
  | 'parse_changed'
  | 'invalid_config';

function redactDiagnostic(value: string): string {
  return value
    .replaceAll(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replaceAll(/(cookie|token|password|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240);
}

export class SourceError extends Error {
  public readonly category: SourceErrorCategory;
  public readonly safeDiagnostic: string;
  public readonly retryAfterAt: number | null;
  public override readonly cause: unknown;

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

export function isSourceError(error: unknown): error is SourceError {
  return error instanceof SourceError;
}
