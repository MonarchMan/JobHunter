import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DestinationStream } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createSafeLogger, redactLogValue } from '../src/index.js';

const temporaryDirectories: string[] = [];

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
