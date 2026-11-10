import { expect, it } from 'vitest';
import { access, rename } from 'node:fs/promises';
import path from 'node:path';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '../../src/persistence/connection.js';
import { createBackup, planRestoreBackup, restoreBackup } from '../../src/persistence/backup.js';
import { acquireTaskServiceLock } from '../../src/persistence/task-service-lock.js';
import { startTaskHostBridge } from '../../src/tasks/host/host-bridge.js';

it('keeps service startup excluded throughout restore, including the directory replacement gap', async () => {
  const root = await createTemporaryDataRoot('jobhunter-restore-service-');
  const source = openSqliteDatabase({ dataRoot: path.join(root.path, 'source') });
  const target = path.join(root.path, 'target');
  const backup = path.join(root.path, 'backup');
  const start = (): ReturnType<typeof startTaskHostBridge> =>
    startTaskHostBridge({
      dataRoot: target,
      configuration: 'fixture',
      createRuntime: () => ({
        run: (signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                resolve();
              },
              { once: true },
            );
          }),
        request: () => null,
        close: () => Promise.resolve(),
      }),
    });
  let service: Awaited<ReturnType<typeof start>> | undefined;
  try {
    source.client
      .prepare("INSERT INTO application_settings VALUES('fixture','\"original\"','v1',1)")
      .run();
    await createBackup(source, backup);
    source.close();
    openSqliteDatabase({ dataRoot: target }).close();
    const plan = await planRestoreBackup(backup, target);
    service = await start();
    await expect(planRestoreBackup(backup, target)).rejects.toThrow(
      'stopping the current Web/CLI host',
    );
    await expect(restoreBackup(backup, target, plan.confirmationToken)).rejects.toThrow(
      'stopping the current Web/CLI host',
    );
    await service?.close();
    const release = acquireTaskServiceLock(target);
    if (!release) throw new Error('Expected maintenance ownership');
    const moved = path.join(root.path, 'moved');
    try {
      await rename(target, moved);
      expect(await start()).toBeNull();
      await expect(access(target)).rejects.toThrow();
      await rename(moved, target);
    } finally {
      release();
    }
    const currentPlan = await planRestoreBackup(backup, target);
    await restoreBackup(backup, target, currentPlan.confirmationToken);
    const restored = openSqliteDatabase({ dataRoot: target });
    try {
      expect(
        restored.client
          .prepare("SELECT value_json FROM application_settings WHERE key='fixture'")
          .pluck()
          .get(),
      ).toBe('"original"');
      expect(restored.client.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      restored.close();
    }
    service = await start();
    expect(service).not.toBeNull();
  } finally {
    await service?.close();
    source.close();
    await root.cleanup();
  }
});
