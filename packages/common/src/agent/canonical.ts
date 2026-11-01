import { createHash } from 'node:crypto';

/** 将值递归转换为键排序且不含特殊数字的规范 JSON 结构。 */
function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON does not support non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

/** 生成用于缓存键和幂等比较的规范 JSON 字符串。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** 计算 UTF-8 字符串的 SHA-256 十六进制摘要。 */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 先规范化值再计算其内容哈希。 */
export function hashCanonical(value: unknown): string {
  return sha256(canonicalJson(value));
}
