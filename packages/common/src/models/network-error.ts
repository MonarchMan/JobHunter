/** 提取网络类失败的安全原因代码，只保留字母数字与点划线，不含地址、URL 或正文。 */
export function networkReason(error: unknown): string {
  const candidates: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 3 || typeof value !== 'object' || value === null) return;
    const record = value as Readonly<Record<string, unknown>>;
    if (typeof record.code === 'string') candidates.push(record.code);
    if (Array.isArray(record.errors)) for (const inner of record.errors) visit(inner, depth + 1);
    visit(record.cause, depth + 1);
  };
  visit(error, 0);
  const raw = candidates[0];
  return raw === undefined ? '' : raw.replaceAll(/[^a-zA-Z0-9_.-]/g, '').slice(0, 48);
}
