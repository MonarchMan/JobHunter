import type { LogFields } from './contracts.js';

/** 按 JSON 编码字节数截断，转义字符不能突破日志预算。 */
function clip(value: string, bytes: number): string {
  if (Buffer.byteLength(JSON.stringify(value)) <= bytes) return value;
  let low = 0,
    high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(value.slice(0, middle) + '…')) <= bytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low) + '…';
}

/** 输入已经脱敏；缩减原因树时优先保留类型、消息、代码和定位帧。 */
function compact(value: unknown, depth: number, stackBytes: number): unknown {
  if (typeof value === 'string') return clip(value, 512);
  if (!value || typeof value !== 'object') return value;
  if (depth < 0) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.slice(0, 2).map((entry: unknown) => compact(entry, depth - 1, stackBytes));
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = { truncated: true };
  for (const key of [
    'name',
    'message',
    'code',
    'status',
    'statusCode',
    'requestId',
    'phase',
    'stack',
    'cause',
    'error',
    'errors',
    'issues',
    'path',
    'expected',
    'omittedErrors',
  ]) {
    if (record[key] === undefined) continue;
    result[key] =
      key === 'stack' && typeof record[key] === 'string'
        ? clip(record[key], stackBytes)
        : compact(record[key], depth - 1, stackBytes);
  }
  if (Array.isArray(record.errors) && record.errors.length > 2)
    result.omittedErrors =
      record.errors.length -
      2 +
      (typeof record.omittedErrors === 'number' ? record.omittedErrors : 0);
  return result;
}

/** 32 KiB 字段预算先丢普通附加字段，再逐级缩减错误树，保留失败摘要和关联身份。 */
export function boundLogFields(fields: LogFields): LogFields {
  if (Buffer.byteLength(JSON.stringify(fields)) <= 32_768) return fields;
  const identity: Record<string, unknown> = { truncated: true };
  for (const key of [
    'hostRunId',
    'taskId',
    'taskType',
    'attempt',
    'correlationId',
    'agentRunId',
    'modelRequestId',
    'errorCategory',
  ]) {
    const value = fields[key];
    if (typeof value === 'string') identity[key] = clip(value, 256);
    else if (typeof value === 'number') identity[key] = value;
  }
  for (const depth of [4, 3, 2, 1, 0]) {
    const result = { ...identity, error: compact(fields.error, depth, depth > 2 ? 2048 : 512) };
    if (Buffer.byteLength(JSON.stringify(result)) <= 32_768) return result;
  }
  return { ...identity, error: { message: 'Diagnostic exceeded its bounded representation.' } };
}
