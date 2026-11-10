import { createHash } from 'node:crypto';
import { redactCredentials } from './redact-credentials.js';

const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g;

/** 规范化日志字段名以便敏感键匹配。 */
function normalizedKey(key: string): string {
  return key.replaceAll(/[-_]/g, '').toLowerCase();
}

/** 判断字段名是否属于密钥、令牌或个人信息。 */
function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    normalized === 'authorization' ||
    normalized.includes('cookie') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.startsWith('email') ||
    normalized.startsWith('phone') ||
    normalized.startsWith('mobile') ||
    normalized === 'resumetext' ||
    normalized === 'resumecontent' ||
    normalized === 'documenttext' ||
    normalized === 'rawresume' ||
    normalized === 'anticontent' ||
    normalized === 'signature'
  );
}

/** URL 只保留协议、主机和路径，禁止凭据、查询参数与片段进入诊断。 */
function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"']+/giu, (raw) => {
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return '[REDACTED_URL]';
    }
  });
}

/** 脱敏有限文本；超长正文只记录哈希与长度。 */
function redactString(value: string): string {
  if (value.length > 2_000)
    return `[REDACTED_LONG_TEXT sha256=${createHash('sha256').update(value).digest('hex')} bytes=${String(Buffer.byteLength(value))}]`;
  return (
    redactCredentials(redactUrls(value))
      .replaceAll(email, '[REDACTED_EMAIL]')
      .replaceAll(phone, '[REDACTED_PHONE]')
      // eslint-disable-next-line no-control-regex -- 终端控制字符必须在诊断边界去除。
      .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

/** 原生错误和跨线程安全快照采用同一堆栈上限，二次脱敏不丢失定位信息。 */
function redactStack(value: string): string {
  return value
    .split('\n')
    .slice(0, 16)
    .map((line) => redactString(line.slice(0, 512)))
    .join('\n');
}

/** 错误字段优先于普通附件，避免字段数量上限先吃掉诊断内容。 */
function* diagnosticKeys(value: object): Generator<string> {
  const priority = [
    'taskId',
    'attempt',
    'correlationId',
    'agentRunId',
    'modelRequestId',
    'error',
    'cause',
  ];
  for (const key of priority) if (Object.hasOwn(value, key)) yield key;
  for (const key in value) if (!priority.includes(key) && Object.hasOwn(value, key)) yield key;
}

/** 有界白名单序列化：不执行 getter/toJSON，任何外部对象都不能使日志抛错。 */
export function redactLogValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let remaining = 256;
  function visit(item: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 8) return '[TRUNCATED]';
    if (typeof item === 'string') return redactString(item);
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'function' || typeof item === 'symbol' || item === undefined) return null;
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return '[CIRCULAR]';
    seen.add(item);
    try {
      if (item instanceof Error) {
        const output: Record<string, unknown> = {};
        const issues = Object.getOwnPropertyDescriptor(item, 'issues')?.value as unknown;
        const schemaFailure = Array.isArray(issues);
        const hidesInput = schemaFailure || item instanceof SyntaxError;
        for (const key of [
          'name',
          'message',
          'stack',
          'code',
          'status',
          'statusCode',
          'requestId',
          'phase',
          'cause',
        ]) {
          const descriptor = Object.getOwnPropertyDescriptor(item, key);
          let field: unknown =
            descriptor && 'value' in descriptor
              ? descriptor.value
              : key === 'name'
                ? 'Error'
                : undefined;
          // Node 的 stack 是延迟访问器；仅该诊断字段允许受保护求值。
          if (key === 'stack' && descriptor?.get) {
            try {
              field = item.stack;
            } catch {
              field = '[UNAVAILABLE_STACK]';
            }
          }
          if (key === 'name' && !descriptor) {
            const inherited = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(item), 'name');
            if (inherited && 'value' in inherited && typeof inherited.value === 'string')
              field = inherited.value;
          }
          if (field === undefined) continue;
          // JSON/Schema 异常消息可能嵌入模型原文，只公开结构诊断与调用帧。
          if (hidesInput && key === 'message')
            field = schemaFailure ? 'Schema validation failed.' : 'Syntax parsing failed.';
          if (hidesInput && key === 'stack' && typeof field === 'string')
            field = field
              .split('\n')
              .filter((line) => /^\s+at\s/u.test(line))
              .join('\n');
          output[key] =
            key === 'stack' && typeof field === 'string'
              ? redactStack(field)
              : visit(field, depth + 1);
        }
        if (schemaFailure) {
          output.issues = issues.slice(0, 16).map((issue: unknown) => {
            if (!issue || typeof issue !== 'object') return { code: 'unknown' };
            const record = issue as Record<string, unknown>;
            return visit(
              { code: record.code, path: record.path, expected: record.expected },
              depth + 1,
            );
          });
          if (issues.length > 16) output.omittedIssues = issues.length - 16;
        }
        if (item instanceof AggregateError) {
          const errors = Object.getOwnPropertyDescriptor(item, 'errors')?.value as unknown;
          if (Array.isArray(errors)) {
            output.errors = errors.slice(0, 8).map((error: unknown) => visit(error, depth + 1));
            if (errors.length > 8) output.omittedErrors = errors.length - 8;
          }
        }
        return output;
      }
      if (Array.isArray(item)) return item.slice(0, 32).map((part) => visit(part, depth + 1));
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      let count = 0;
      for (const key of diagnosticKeys(item)) {
        if (!Object.hasOwn(item, key)) continue;
        if (++count > 32 || remaining < 0) {
          output.truncated = true;
          break;
        }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) {
          output[key] = '[ACCESSOR]';
          continue;
        }
        const field: unknown = descriptor.value;
        if (normalizedKey(key) === 'stack' && typeof field === 'string') {
          output[key] = redactStack(field);
        } else if (normalizedKey(key) === 'response') {
          const safe = visit(field, depth + 1);
          const serialized = JSON.stringify(safe);
          const status =
            safe && typeof safe === 'object'
              ? ((safe as Record<string, unknown>).status ??
                (safe as Record<string, unknown>).statusCode)
              : null;
          output[key] = {
            status: typeof status === 'number' ? status : null,
            bytes: Buffer.byteLength(serialized),
            sha256: createHash('sha256').update(serialized).digest('hex'),
            bounded: true,
          };
        } else
          output[key] =
            isSensitiveKey(key) ||
            ['payload', 'body', 'prompt', 'messages', 'content', 'text'].includes(
              normalizedKey(key),
            )
              ? '[REDACTED]'
              : visit(field, depth + 1);
      }
      return output;
    } catch {
      return '[UNSERIALIZABLE]';
    }
  }
  try {
    return visit(value, 0);
  } catch {
    return '[UNSERIALIZABLE]';
  }
}
