import { createHash } from 'node:crypto';

const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const credentialAssignment = /\b(api[-_ ]?key|token|password|cookie)\s*[:=]\s*[^\s,;]+/gi;

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

/** 将响应对象压缩为安全的类型/长度摘要。 */
function summarizeUnknownResponse(value: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = '[unserializable]';
  }
  const record =
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  return {
    status: record.status ?? record.statusCode ?? null,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
  };
}

/** 脱敏字符串中的邮箱、手机号、Bearer 和凭据赋值。 */
function redactString(value: string): string {
  if (value.length > 2_000) {
    const hash = createHash('sha256').update(value, 'utf8').digest('hex');
    return `[REDACTED_LONG_TEXT sha256=${hash} bytes=${String(Buffer.byteLength(value, 'utf8'))}]`;
  }
  return value
    .replaceAll(bearer, 'Bearer [REDACTED]')
    .replaceAll(credentialAssignment, '$1=[REDACTED]')
    .replaceAll(email, '[REDACTED_EMAIL]')
    .replaceAll(phone, '[REDACTED_PHONE]');
}

/** 递归脱敏日志载荷并处理循环引用。 */
export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.cause === undefined ? {} : { cause: redactLogValue(value.cause, seen) }),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (normalizedKey(key) === 'response') output[key] = summarizeUnknownResponse(item);
    else output[key] = isSensitiveKey(key) ? '[REDACTED]' : redactLogValue(item, seen);
  }
  return output;
}
