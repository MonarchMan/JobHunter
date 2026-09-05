import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openSqliteDatabase } from '@jobhunter/db';
import { createSqliteMaintenanceTick } from '../src/sqlite-maintenance.js';

describe('SQLite maintenance worker composition', () => {
  it('passes shutdown to the actual child process and waits for it to close', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-maintenance-abort-'));
    const database = openSqliteDatabase({ dataRoot: root });
    try {
      const abort = new AbortController();
      const run = createSqliteMaintenanceTick(database)(abort.signal);
      abort.abort();
      await expect(run).rejects.toMatchObject({ name: 'AbortError' });
      expect(database.client.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs the built child entry and persists one summary without creating a no-op task', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobhunter-maintenance-child-'));
    const database = openSqliteDatabase({ dataRoot: root });
    try {
      const tick = createSqliteMaintenanceTick(database);
      await tick();
      const summary = database.client
        .prepare('SELECT summary_json FROM database_maintenance')
        .pluck()
        .get();
      expect(JSON.parse(String(summary))).toMatchObject({ outcome: 'healthy' });
      await tick();
      expect(database.client.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(0);
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
