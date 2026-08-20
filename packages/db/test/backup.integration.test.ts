import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { utcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBackup,
  listBackups,
  openSqliteDatabase,
  planRestoreBackup,
  restoreBackup,
  SqliteArtifactStore,
  verifyBackup,
  type SqliteDatabaseHandle,
} from '../src/index.js';

const roots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});

async function container(): Promise<string> {
  const root = await createTemporaryDataRoot('jobhunter-backup-');
  roots.push(root);
  return root.path;
}

describe('database and artifact backup', () => {
  it('backs up a snapshot and only artifacts referenced at snapshot time', async () => {
    const root = await container();
    const source = openSqliteDatabase({ dataRoot: path.join(root, 'source') });
    handles.push(source);
    const artifacts = new SqliteArtifactStore(source.client, source.dataRoot);
    const first = await artifacts.put({
      id: '018f0000-0000-7000-8000-000000000060',
      kind: 'resume',
      mediaType: 'text/plain',
      content: new TextEncoder().encode('before snapshot'),
      createdAt: utcInstant(1),
    });

    const backupDirectory = path.join(root, 'backup');
    const manifest = await createBackup(source, backupDirectory);
    expect(manifest.artifacts.map((artifact) => artifact.id)).toEqual([first.id]);
    await expect(verifyBackup(backupDirectory)).resolves.toEqual(manifest);
    await expect(listBackups(root)).resolves.toMatchObject([
      {
        directory: backupDirectory,
        artifactCount: 1,
        totalArtifactBytes: 15,
        manifestValid: true,
      },
    ]);

    await artifacts.put({
      id: '018f0000-0000-7000-8000-000000000061',
      kind: 'resume',
      mediaType: 'text/plain',
      content: new TextEncoder().encode('after snapshot'),
      createdAt: utcInstant(2),
    });
    source.close();
    handles.splice(handles.indexOf(source), 1);

    const restoredRoot = path.join(root, 'restored');
    const restorePlan = await planRestoreBackup(backupDirectory, restoredRoot);
    await restoreBackup(backupDirectory, restoredRoot, restorePlan.confirmationToken);
    const restored = openSqliteDatabase({ dataRoot: restoredRoot, runMigrations: false });
    handles.push(restored);
    expect(restored.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
    expect(await readFile(path.join(restoredRoot, first.relativePath), 'utf8')).toBe(
      'before snapshot',
    );
  });

  it('rejects tampered files before replacing the target data root', async () => {
    const root = await container();
    const source = openSqliteDatabase({ dataRoot: path.join(root, 'source') });
    handles.push(source);
    const artifact = await new SqliteArtifactStore(source.client, source.dataRoot).put({
      id: '018f0000-0000-7000-8000-000000000062',
      kind: 'resume',
      mediaType: 'text/plain',
      content: new TextEncoder().encode('original'),
      createdAt: utcInstant(1),
    });
    const backupDirectory = path.join(root, 'backup');
    await createBackup(source, backupDirectory);

    const target = path.join(root, 'target');
    const targetHandle = openSqliteDatabase({ dataRoot: target });
    targetHandle.close();
    await writeFile(path.join(target, 'sentinel'), 'keep');
    const restorePlan = await planRestoreBackup(backupDirectory, target);
    await writeFile(path.join(backupDirectory, 'files', artifact.relativePath), 'tampered');
    await expect(verifyBackup(backupDirectory)).rejects.toThrow(/does not match manifest/);

    await expect(
      restoreBackup(backupDirectory, target, restorePlan.confirmationToken),
    ).rejects.toThrow(/does not match manifest/);
    await expect(access(path.join(target, 'sentinel'))).resolves.toBeUndefined();
  });

  it('refuses restore while an in-process target connection is active', async () => {
    const root = await container();
    const source = openSqliteDatabase({ dataRoot: path.join(root, 'source') });
    handles.push(source);
    const backupDirectory = path.join(root, 'backup');
    await createBackup(source, backupDirectory);

    const target = openSqliteDatabase({ dataRoot: path.join(root, 'target') });
    handles.push(target);
    await expect(planRestoreBackup(backupDirectory, target.dataRoot)).rejects.toThrow(
      /handles to be closed/,
    );
  });

  it('invalidates confirmation when the target changes after dry-run', async () => {
    const root = await container();
    const source = openSqliteDatabase({ dataRoot: path.join(root, 'source') });
    handles.push(source);
    const backupDirectory = path.join(root, 'backup');
    await createBackup(source, backupDirectory);
    const target = path.join(root, 'target');
    const plan = await planRestoreBackup(backupDirectory, target, { now: 1_000 });
    await expect(
      restoreBackup(backupDirectory, target, plan.confirmationToken, {
        now: plan.expiresAt + 1,
      }),
    ).rejects.toThrow(/invalid or expired/);

    const targetHandle = openSqliteDatabase({ dataRoot: target });
    targetHandle.close();
    await writeFile(path.join(target, 'sentinel'), 'created-after-plan');
    await expect(
      restoreBackup(backupDirectory, target, plan.confirmationToken, { now: 1_001 }),
    ).rejects.toThrow(/changed after the dry-run/);
    await expect(readFile(path.join(target, 'sentinel'), 'utf8')).resolves.toBe(
      'created-after-plan',
    );
  });

  it('rejects the workspace root as a restore target before touching it', async () => {
    await expect(planRestoreBackup('missing-backup', process.cwd())).rejects.toThrow(/too broad/);
  });
});
