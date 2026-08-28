import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLocalCli, type CliIo } from '../src/index.js';

function memoryIo(): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: { write: (value) => void stdout.push(value) },
      stderr: { write: (value) => void stderr.push(value) },
    },
  };
}

async function command(
  dataRoot: string,
  argv: readonly string[],
): Promise<{
  readonly exitCode: number;
  readonly body: Record<string, unknown>;
  readonly stderr: string;
}> {
  const output = memoryIo();
  const exitCode = await runLocalCli({
    argv: ['--json', '--data-root', dataRoot, ...argv],
    io: output.io,
    environment: {},
  });
  return {
    exitCode,
    body: JSON.parse(output.stdout.join('')) as Record<string, unknown>,
    stderr: output.stderr.join(''),
  };
}

function companyCount(dataRoot: string): number {
  const database = openSqliteDatabase({ dataRoot });
  try {
    return Number(database.client.prepare('SELECT count(*) FROM companies').pluck().get());
  } finally {
    database.close();
  }
}

function addPostBackupMutation(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  try {
    database.client.exec(`
      INSERT INTO companies (id, slug, name, aliases_json, enabled, created_at, updated_at)
      VALUES ('018f0000-0000-7000-8000-000000000701', 'after-backup', '备份后公司', '[]', 1, 1, 1)
    `);
  } finally {
    database.close();
  }
}

describe('backup commands', () => {
  it('creates, lists, verifies, dry-runs and explicitly confirms a restore', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-backup-');
    const dataRoot = path.join(root.path, '当前 数据');
    const backupRoot = path.join(root.path, '备份 根目录');
    const backupDirectory = path.join(backupRoot, '备份 一');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const created = await command(dataRoot, ['backup', 'create', backupDirectory]);
      expect(created.exitCode).toBe(0);
      expect(created.stderr).toBe('');
      expect(created.body).toMatchObject({
        ok: true,
        data: { directory: backupDirectory, manifest: { formatVersion: 1 } },
      });
      expect((await command(dataRoot, ['backup', 'list', backupRoot])).body).toMatchObject({
        data: { backups: [{ directory: backupDirectory, manifestValid: true }] },
      });
      expect((await command(dataRoot, ['backup', 'verify', backupDirectory])).body).toMatchObject({
        ok: true,
        data: { manifest: { formatVersion: 1 } },
      });

      addPostBackupMutation(dataRoot);
      expect(companyCount(dataRoot)).toBe(16);
      const planned = await command(dataRoot, ['backup', 'restore', backupDirectory]);
      expect(planned.exitCode).toBe(0);
      const plan = planned.body as {
        readonly data: {
          readonly dryRun: boolean;
          readonly plan: { readonly confirmationToken: string; readonly targetDataRoot: string };
        };
      };
      expect(plan.data.dryRun).toBe(true);
      expect(plan.data.plan.targetDataRoot).toBe(dataRoot);
      expect(companyCount(dataRoot)).toBe(16);

      const rejected = await command(dataRoot, [
        'backup',
        'restore',
        backupDirectory,
        '--confirm',
        'invalid-token',
      ]);
      expect(rejected.exitCode).toBe(2);
      expect(rejected.body).toMatchObject({ ok: false, error: { code: 'RESTORE_REJECTED' } });
      expect(companyCount(dataRoot)).toBe(16);

      const restored = await command(dataRoot, [
        'backup',
        'restore',
        backupDirectory,
        '--confirm',
        plan.data.plan.confirmationToken,
      ]);
      expect(restored.exitCode).toBe(0);
      expect(restored.body).toMatchObject({
        ok: true,
        data: {
          dryRun: false,
          result: { restoredDataRoot: dataRoot },
        },
      });
      expect(
        (
          restored.body as {
            readonly data: { readonly result: { readonly previousDataRoot: string | null } };
          }
        ).data.result.previousDataRoot,
      ).toBeTypeOf('string');
      expect(companyCount(dataRoot)).toBe(15);

      await appendFile(path.join(backupDirectory, 'jobhunter.sqlite'), 'tampered');
      const invalid = await command(dataRoot, ['backup', 'verify', backupDirectory]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.body).toMatchObject({
        ok: false,
        error: { code: 'BACKUP_VERIFY_FAILED' },
      });
    } finally {
      await root.cleanup();
    }
  }, 30_000);
});
