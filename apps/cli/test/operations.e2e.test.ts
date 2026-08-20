import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { createBackup, openSqliteDatabase, SqliteArtifactStore, verifyBackup } from '@jobhunter/db';
import { utcInstant } from '@jobhunter/domain';
import { createSafeLogger } from '@jobhunter/observability';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('operations composition', () => {
  it('handles spaced Unicode paths, config precedence, secret logs, and backup tampering', async () => {
    const container = await createTemporaryDataRoot('jobhunter-operations-e2e-');
    const dataRoot = path.join(container.path, '含 空格', '数据目录');
    const bootstrap = resolveBootstrapConfig({
      cwd: container.path,
      cli: { dataRoot },
      environment: { JOBHUNTER_DATA_ROOT: path.join(container.path, '环境目录') },
    });
    const config = resolveAppConfig({
      bootstrap,
      cli: { logLevel: 'debug' },
      environment: {
        JOBHUNTER_LOG_LEVEL: 'warn',
        JOBHUNTER_MODEL_API_KEY: 'e2e-api-secret',
      },
      file: { logLevel: 'error', worker: { pollIntervalMs: 2_000 } },
    });
    expect(config.bootstrap.dataRoot).toEqual({ value: dataRoot, source: 'cli' });
    expect(config.logLevel).toEqual({ value: 'debug', source: 'cli' });
    expect(config.worker.pollIntervalMs).toEqual({ value: 2_000, source: 'file' });
    expect(JSON.stringify(config)).not.toContain('e2e-api-secret');

    const lines: string[] = [];
    const logger = createSafeLogger({
      stderr: {
        write(value): void {
          lines.push(value);
        },
      },
    });
    logger.error('operations.e2e', {
      authorization: 'Bearer e2e-token',
      email: 'candidate@example.com',
      resumeText: 'private resume body',
    });
    await logger.close();
    const logs = lines.join('');
    for (const secret of ['e2e-token', 'candidate@example.com', 'private resume body']) {
      expect(logs).not.toContain(secret);
    }

    const database = openSqliteDatabase({ dataRoot });
    try {
      const artifact = await new SqliteArtifactStore(database.client, dataRoot).put({
        id: '018f0000-0000-7000-8000-00000000f100',
        kind: 'resume',
        mediaType: 'text/plain',
        content: new TextEncoder().encode('redacted fixture'),
        createdAt: utcInstant(1),
      });
      const backupRoot = path.join(container.path, '备份 目录', 'backup-one');
      await createBackup(database, backupRoot);
      await expect(verifyBackup(backupRoot)).resolves.toMatchObject({ formatVersion: 1 });
      await writeFile(path.join(backupRoot, 'files', artifact.relativePath), 'tampered');
      await expect(verifyBackup(backupRoot)).rejects.toThrow(/does not match manifest/);
    } finally {
      database.close();
      await container.cleanup();
    }
  });
});
