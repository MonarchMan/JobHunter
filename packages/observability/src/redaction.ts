import { createHash } from 'node:crypto';

const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function normalizedKey(key: string): string {
  return key.replaceAll(/[-_]/g, '').toLowerCase();
}

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

function redactString(value: string): string {
  if (value.length > 2_000) {
    const hash = createHash('sha256').update(value, 'utf8').digest('hex');
    return `[REDACTED_LONG_TEXT sha256=${hash} bytes=${String(Buffer.byteLength(value, 'utf8'))}]`;
  }
  return value
    .replaceAll(bearer, 'Bearer [REDACTED]')
    .replaceAll(email, '[REDACTED_EMAIL]')
    .replaceAll(phone, '[REDACTED_PHONE]');
}

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
