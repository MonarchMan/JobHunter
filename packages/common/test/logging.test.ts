import { RotatingFileStream } from '../src/logging/rotating-file-stream.js';
import { z } from 'zod';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DestinationStream } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSafeLogger, redactLogValue } from '../src/logging/index.js';
import { classifyAgentError, sanitizeAgentErrorSummary } from '../src/agent/errors.js';
import { sanitizeTaskErrorSummary } from '../src/tasks/scheduling/retry-policy.js';

const temporaryDirectories: string[] = [];

it('redacts quoted and escaped credentials in messages, stacks and persisted summaries', () => {
  const message = JSON.stringify({
    api_key: 'private-key',
    password: 'private "quoted" suffix',
    cookie: 'session=value; private-cookie',
  });
  const lines: string[] = [];
  createSafeLogger({ stderr: { write: (line) => lines.push(line) } }).error('test.failed', {
    error: new Error('outer', { cause: new Error(message) }),
  });
  for (const output of [
    lines.join(''),
    sanitizeAgentErrorSummary(message),
    sanitizeTaskErrorSummary(message),
  ]) {
    for (const secret of ['private-key', 'quoted', 'suffix', 'private-cookie', 'session=value'])
      expect(output).not.toContain(secret);
  }
});

it('does not copy parsing input into normalized error messages or persisted summaries', () => {
  const result = z.object({}).strict().safeParse({ private_input_marker: true });
  if (result.success) throw new Error('Expected invalid input');
  for (const original of [result.error, new SyntaxError('Unexpected token private_input_marker')]) {
    const classified = classifyAgentError(original);
    expect(classified.cause).toBe(original);
    expect(JSON.stringify(redactLogValue(classified))).not.toContain('private_input_marker');
    expect(sanitizeAgentErrorSummary(classified.message)).not.toContain('private_input_marker');
  }
});

it('retains bounded aggregate children and reports omissions without leaking credentials', () => {
  const error = new AggregateError(
    Array.from({ length: 10 }, (_, index) =>
      Object.assign(new Error(`failure-${String(index)} token=fixture-secret-token`), {
        code: 'ECONNRESET',
      }),
    ),
    'cleanup failed',
  );
  const result = redactLogValue(error) as { errors: unknown[]; omittedErrors: number };
  expect(result.errors).toHaveLength(8);
  expect(result.omittedErrors).toBe(2);
  expect(JSON.stringify(result)).toContain('ECONNRESET');
  expect(JSON.stringify(result)).not.toContain('fixture-secret-token');
});

it('keeps error evidence when attachments exceed the event budget or field limit', () => {
  const lines: string[] = [];
  const logger = createSafeLogger({ stderr: { write: (line) => lines.push(line) } });
  const fields = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`field${String(index)}`, '附'.repeat(1800)]),
  );
  logger.error('fixture.failed', {
    ...fields,
    taskId: 'task-1',
    error: Object.assign(new Error('critical failure', { cause: new Error('root cause') }), {
      code: 'ECONNRESET',
    }),
  });
  const result = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  expect(result.truncated).toBe(true);
  expect(result.taskId).toBe('task-1');
  expect(lines[0]).toContain('critical failure');
  expect(lines[0]).toContain('root cause');
  expect(lines[0]).toContain('ECONNRESET');
  expect(Buffer.byteLength(lines[0] ?? '')).toBeLessThan(34_000);
});

it('keeps schema paths while excluding validation input and JSON source excerpts', () => {
  const parsed = z.object({ count: z.number() }).safeParse({ count: 'private-model-body' });
  if (parsed.success) throw new Error('Expected schema failure');
  const schema = JSON.stringify(redactLogValue(parsed.error));
  expect(schema).toContain('count');
  expect(schema).toContain('invalid_type');
  expect(schema).not.toContain('private-model-body');
  const syntax = new SyntaxError('Unexpected token in private-model-body');
  expect(JSON.stringify(redactLogValue(syntax))).not.toContain('private-model-body');
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('safe structured logging', () => {
  it('redacts sensitive fields, contact details, authorization values, and long resume text', () => {
    const lines: string[] = [];
    const destination: DestinationStream = { write: (value) => lines.push(value) };
    const resumeBody = `脱敏简历正文-${'项目经历'.repeat(600)}`;
    const logger = createSafeLogger({ stderr: destination });
    logger.child({ taskId: 'task-1' }).error('task.failed', {
      authorization: 'Bearer raw-token',
      cookie: 'session=raw-cookie',
      apiKey: 'raw-key',
      antiContent: 'private-source-signature',
      emailAddress: 'candidate@example.com',
      message: '联系 candidate@example.com 或 13800138000',
      resumeText: resumeBody,
      error: new Error(resumeBody),
      response: { status: 403, body: 'private-response-body' },
    });

    const output = lines.join('');
    expect(output).toContain('task.failed');
    expect(output).toContain('task-1');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('[REDACTED_EMAIL]');
    expect(output).toContain('[REDACTED_PHONE]');
    for (const secret of [
      'raw-token',
      'raw-cookie',
      'raw-key',
      'candidate@example.com',
      '13800138000',
      resumeBody,
      'private-source-signature',
      'private-response-body',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('handles circular structures without throwing', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(redactLogValue(value)).toEqual({ self: '[CIRCULAR]' });
  });

  it('retains nested error diagnostics while redacting credential-shaped cause messages', () => {
    const lines: string[] = [];
    const logger = createSafeLogger({ stderr: { write: (value) => lines.push(value) } });
    const launchError = new Error(
      'Executable does not exist at /Applications/Browser token=browser-secret',
    );
    const taskError = new Error('Browser operation failed.', { cause: launchError });

    logger.error('task.failed', { error: taskError });

    const output = lines.join('');
    expect(output).toContain('Browser operation failed.');
    expect(output).toContain('Executable does not exist at /Applications/Browser');
    expect(output).toContain('token=[REDACTED]');
    expect(output).not.toContain('browser-secret');
  });

  it('writes JSON to a rotating local file as well as stderr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-logs-'));
    temporaryDirectories.push(root);
    const logPath = join(root, 'logs', 'jobhunter.log');
    const logger = createSafeLogger({
      stderr: { write: () => undefined },
      logFile: logPath,
      maxFileBytes: 1_024,
      maxFiles: 2,
    });
    for (let index = 0; index < 30; index += 1) {
      logger.info('rotation.fixture', { index, payload: 'x'.repeat(80) });
    }
    await logger.close();
    const current = await readFile(logPath, 'utf8');
    const previous = await readFile(`${logPath}.1`, 'utf8');
    expect(current).toContain('rotation.fixture');
    expect(previous).toContain('rotation.fixture');
  });
});

// 1、失败输入来自外部边界；断言诊断仍可用且不会遮蔽业务异常。
describe('logging failure isolation and diagnostic evidence', () => {
  it('keeps stack, error code and nested causes without leaking URL credentials', () => {
    const error = Object.assign(
      new Error('fetch https://user:pass@example.test/path?token=private#secret', {
        cause: new Error('token=hidden'),
      }),
      { code: 'ECONNRESET' },
    );
    const safe = redactLogValue(error) as Record<string, unknown>;
    expect(safe.code).toBe('ECONNRESET');
    expect(safe.stack).toContain('logging.test.ts');
    expect(JSON.stringify(safe)).not.toMatch(/user:pass|token=private|#secret|token=hidden/);
    expect(safe.message).toContain('https://example.test/path');
  });
  it('does not evaluate disabled fields and handles undefined, bigint and throwing accessors', async () => {
    const lines: string[] = [];
    const logger = createSafeLogger({
      level: 'error',
      stderr: { write: (line) => lines.push(line) },
    });
    const fields = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get() {
        throw new Error('private');
      },
    });
    expect(() => {
      logger.debug('disabled', fields);
    }).not.toThrow();
    expect(() => {
      logger.error('fixture', { response: undefined, large: 1n, nested: fields });
    }).not.toThrow();
    expect(
      (JSON.parse(lines[0] ?? '{}') as { response: { bytes: number } }).response.bytes,
    ).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('private');
    await logger.close();
  });
  it('separates file verbosity from concise console output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-levels-'));
    temporaryDirectories.push(root);
    const lines: string[] = [];
    const logger = createSafeLogger({
      level: 'debug',
      consoleLevel: 'warn',
      format: 'pretty',
      stderr: { write: (line) => lines.push(line) },
      logFile: join(root, 'app.log'),
    });
    logger.debug('fixture.detail');
    logger.info('task.finished');
    logger.error('task.failed', { taskId: 'task-1', error: new Error('secret details') });
    await logger.close();
    const file = await readFile(join(root, 'app.log'), 'utf8');
    expect(file).toContain('fixture.detail');
    expect(file).toContain('secret details');
    expect(lines.join('')).toContain('任务失败');
    expect(lines.join('')).toContain('task-1');
    expect(lines.join('')).not.toContain('secret details');
    expect(lines.join('')).not.toContain('fixture.detail');
  });
  it('degrades once when the log file cannot open, preserving business execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-unwritable-'));
    temporaryDirectories.push(root);
    const lines: string[] = [];
    const logger = createSafeLogger({
      logFile: root,
      stderr: { write: (line) => lines.push(line) },
    });
    expect(() => {
      logger.info('first');
      logger.error('second');
    }).not.toThrow();
    await logger.close();
    expect(lines.filter((line) => line.includes('logging.degraded'))).toHaveLength(1);
    expect(lines.join('')).toContain('first');
    expect(lines.join('')).toContain('second');
  });
  it('does not let a child close the shared file sink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-owner-'));
    temporaryDirectories.push(root);
    const logger = createSafeLogger({
      logFile: join(root, 'app.log'),
      stderr: {
        write() {
          /* 测试不向终端输出。 */
        },
      },
    });
    await logger.child({ taskId: 'a' }).close();
    logger.info('still.open');
    await logger.close();
    await logger.close();
    expect(await readFile(join(root, 'app.log'), 'utf8')).toContain('still.open');
  });
});

it('does not invoke field accessors or allow callers to forge the envelope', () => {
  const lines: string[] = [];
  let reads = 0;
  const fields = Object.defineProperty({ level: 10, time: 'forged', pid: -1 }, 'hostile', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('unexpected getter');
    },
  });
  const logger = createSafeLogger({ stderr: { write: (line) => lines.push(line) } });
  logger.info('valid', fields);
  expect(reads).toBe(0);
  const result = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  expect(result.level).toBe(30);
  expect(result.time).not.toBe('forged');
  expect(result.pid).toBe(process.pid);
});

it('isolates disk write failures after initialization and emits one degradation warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobhunter-disk-failure-'));
  temporaryDirectories.push(root);
  const lines: string[] = [];
  const logger = createSafeLogger({
    logFile: join(root, 'app.log'),
    stderr: { write: (line) => lines.push(line) },
  });
  const write = vi
    .spyOn(RotatingFileStream.prototype, '_write')
    .mockImplementation((_chunk, _encoding, callback) => {
      callback(new Error('synthetic ENOSPC'));
    });
  try {
    expect(() => {
      logger.info('first');
    }).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    logger.info('after.failure');
    logger.error('still.running');
    await logger.close();
    expect(lines.filter((line) => line.includes('logging.degraded'))).toHaveLength(1);
    expect(lines.join('')).toContain('after.failure');
    expect(lines.join('')).not.toContain('synthetic ENOSPC');
  } finally {
    write.mockRestore();
    await logger.close();
  }
});

it('preserves bounded stacks through repeated redaction at transport boundaries', () => {
  const error = new Error('fixture');
  error.stack =
    `Error: fixture\n${' at /some/long/path/to/source.ts:42:1 token=private'.repeat(8)}\n`.repeat(
      12,
    );
  const first = redactLogValue(error);
  const second = redactLogValue(first) as { stack: string };
  expect(second.stack).toContain('source.ts:42:1');
  expect(second.stack).not.toContain('private');
  expect(second.stack.length).toBeLessThan(8192);
});
