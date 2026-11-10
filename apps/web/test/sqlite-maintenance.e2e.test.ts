import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from '../src/server/http.js';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/common/config/index';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { createLocalWebContainer } from '../src/server/container.js';

// 日志行为由 http-logging 覆盖；此测试不写工作区运行目录。
vi.mock('../src/server/logging.js', () => ({
  getWebLogger: () => Promise.resolve({ warn: vi.fn(), error: vi.fn() }),
}));

describe('SQLite maintenance HTTP responses', () => {
  it('keeps maintenance audits read-only in the application service', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-audit-');
    const id = '018f0000-0000-7000-8000-000000000701';
    try {
      const database = openSqliteDatabase({ dataRoot: root.path });
      database.client
        .prepare(
          `INSERT INTO tasks(id,task_type,private_state,status,idempotency_key,
        available_at,created_at) VALUES(?,'maintenance.sqlite','{}','failed',?,0,0)`,
        )
        .run(id, id);
      database.close();
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        expect(container.services.diagnostics.getTask(id)?.taskType).toBe('maintenance.sqlite');
        expect(() => container.services.diagnostics.mutate({ kind: 'cancel', taskId: id })).toThrow(
          'read-only',
        );
        expect(() =>
          container.services.diagnostics.mutate({
            kind: 'retry',
            taskId: id,
            idempotencyToken: id,
          }),
        ).toThrow('read-only');
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });

  it('returns a retryable 503 for guarded writes and lock timeouts without leaking details', async () => {
    for (const error of [
      new Error('wrapped', { cause: new Error('JOBHUNTER_DATABASE_MAINTENANCE') }),
      Object.assign(new Error('/private/database.sqlite'), { code: 'SQLITE_BUSY' }),
    ]) {
      const response = await errorResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('5');
      expect(await response.text()).not.toContain('/private');
    }
  });
});
