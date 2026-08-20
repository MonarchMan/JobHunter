import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase, readLocalHealthSnapshot, sqliteDoctorCheck } from '../src/index.js';

describe('SQLite doctor check', () => {
  it('checks capabilities, integrity, and the migrated schema offline', async () => {
    const root = await createTemporaryDataRoot('jobhunter-doctor-');
    const handle = openSqliteDatabase({ dataRoot: root.path });
    try {
      expect(await sqliteDoctorCheck(handle.client).run()).toMatchObject({
        status: 'healthy',
        details: { missingTables: [] },
      });
      expect(readLocalHealthSnapshot(handle.client, root.path)).toEqual({
        sources: { enabled: 0, degraded: 0, unhealthy: 0 },
        tasks: { pending: 0, running: 0, failed: 0 },
        files: { referenced: 0, missing: 0 },
      });
    } finally {
      handle.close();
      await root.cleanup();
    }
  });

  it('reports an incomplete schema without performing migrations', async () => {
    const root = await createTemporaryDataRoot('jobhunter-doctor-empty-');
    const handle = openSqliteDatabase({ dataRoot: root.path, runMigrations: false });
    try {
      expect(await sqliteDoctorCheck(handle.client).run()).toMatchObject({
        status: 'failed',
        recommendation: '运行数据库迁移后重新检查。',
      });
    } finally {
      handle.close();
      await root.cleanup();
    }
  });
});
