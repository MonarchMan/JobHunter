import { describe, expect, it } from 'vitest';
import { errorResponse } from '../src/server/http.js';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { createLocalWebContainer } from '../src/server/container.js';

describe('SQLite maintenance HTTP responses', () => {
  it('keeps maintenance audits read-only in the application service', async () => {
    const root = await createTemporaryDataRoot('jobhunter-maintenance-audit-');
    const id = '018f0000-0000-7000-8000-000000000701';
    try {
      const database = openSqliteDatabase({ dataRoot: root.path });
      database.client
        .prepare(
          `INSERT INTO tasks(id,task_type,payload_json,status,idempotency_key,
        max_attempts,available_at,created_at) VALUES(?,'maintenance.sqlite','{}','failed',?,1,0,0)`,
        )
        .run(id, id);
      database.close();
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
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
      const response = errorResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('5');
      expect(await response.text()).not.toContain('/private');
    }
  });
});
