import { createHash } from 'node:crypto';
import { DomainError } from './domain-error.js';

declare const contentHashBrand: unique symbol;
export type ContentHash = string & { readonly [contentHashBrand]: true };
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type CanonicalValue =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

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

export function canonicalJson(value: unknown, sortArrayPaths: readonly string[] = []): string {
  return JSON.stringify(canonicalize(value, '', new Set(sortArrayPaths)));
}

export function contentHash(value: unknown, sortArrayPaths: readonly string[] = []): ContentHash {
  return createHash('sha256')
    .update(canonicalJson(value, sortArrayPaths), 'utf8')
    .digest('hex') as ContentHash;
}

export function parseContentHash(value: string): ContentHash {
  if (!SHA256_HEX.test(value)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Content hash must be lowercase SHA-256 hex.');
  }
  return value as ContentHash;
}
