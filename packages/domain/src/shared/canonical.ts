import { createHash } from 'node:crypto';
import { DomainError } from './domain-error.js';

declare const contentHashBrand: unique symbol;
/** 领域模型的类型约束。 */
export type ContentHash = string & { readonly [contentHashBrand]: true };
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 领域模型的类型约束。 */
export type CanonicalValue =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/** 递归排序对象键，并按指定路径对无序数组排序。 */
function canonicalize(
  value: unknown,
  path: string,
  sortArrayPaths: ReadonlySet<string>,
): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DomainError(
        'INVALID_DOMAIN_VALUE',
        'Canonical values cannot contain non-finite numbers.',
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const values = value.map((item, index) =>
      canonicalize(item, `${path}/${String(index)}`, sortArrayPaths),
    );
    if (!sortArrayPaths.has(path)) return values;
    return values.toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  if (typeof value === 'object') {
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child, `${path}/${key}`, sortArrayPaths);
    }
    return result;
  }
  throw new DomainError('INVALID_DOMAIN_VALUE', `Unsupported canonical value at ${path || '/'}.`);
}

/** 生成领域对象的稳定 JSON 表示，用于哈希和幂等比较。 */
export function canonicalJson(value: unknown, sortArrayPaths: readonly string[] = []): string {
  return JSON.stringify(canonicalize(value, '', new Set(sortArrayPaths)));
}

/** 计算领域对象的稳定 SHA-256 内容哈希。 */
export function contentHash(value: unknown, sortArrayPaths: readonly string[] = []): ContentHash {
  return createHash('sha256')
    .update(canonicalJson(value, sortArrayPaths), 'utf8')
    .digest('hex') as ContentHash;
}

/** 校验外部传入的 SHA-256 字符串并转换为领域哈希类型。 */
export function parseContentHash(value: string): ContentHash {
  if (!SHA256_HEX.test(value)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Content hash must be lowercase SHA-256 hex.');
  }
  return value as ContentHash;
}
