import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSafeLogger } from '@jobhunter/common/logging';
import { getWebLogger } from '../src/server/logging.js';
import { errorResponse } from '../src/server/http.js';
vi.mock('../src/server/logging.js', () => ({ getWebLogger: vi.fn() }));

describe('HTTP diagnostic correlation', () => {
  it('records matching 500 and 503 IDs with safe request and error details', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-http-log-'));
    const logger = createSafeLogger({
      logFile: join(root, 'http.log'),
      stderr: {
        write() {
          /* 测试不向终端输出。 */
        },
      },
    });
    vi.mocked(getWebLogger).mockResolvedValue(logger);
    try {
      for (const [error, status] of [
        [new Error('token=private'), 500],
        [Object.assign(new Error('database busy'), { code: 'SQLITE_BUSY' }), 503],
      ] as const) {
        const response = await errorResponse(
          error,
          new Request('http://localhost/api/jobs?token=private'),
        );
        const body = (await response.json()) as { error: { correlationId: string } };
        expect(response.status).toBe(status);
        expect(JSON.stringify(body)).not.toMatch(/private|stack|database busy/);
        const lines = (await readFile(join(root, 'http.log'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { correlationId: string; error: { stack: string } });
        const record = lines.find((row) => row.correlationId === body.error.correlationId);
        expect(record).toMatchObject({ method: 'GET', path: '/api/jobs', statusCode: status });
        expect(record?.error.stack).toContain('http-logging.test.ts');
        expect(JSON.stringify(record)).not.toContain('private');
      }
    } finally {
      await logger.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
