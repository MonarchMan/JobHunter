import { runLocalCli, type CliIo } from '../src/index.js';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function memoryIo(): { readonly io: CliIo; readonly stdout: string[]; readonly stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: {
        write: (value) => {
          stdout.push(value);
        },
      },
      stderr: {
        write: (value) => {
          stderr.push(value);
        },
      },
    },
  };
}

describe('init and doctor commands', () => {
  it('resolves a POSIX-style relative data path with spaces and Chinese characters', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-relative-');
    const relativeDataRoot = './相对 数据';
    const expectedDataRoot = path.resolve(root.path, '相对 数据');
    try {
      const output = memoryIo();
      expect(
        await runLocalCli({
          argv: ['--json', '--data-root', relativeDataRoot, 'init'],
          io: output.io,
          environment: {},
          cwd: root.path,
        }),
      ).toBe(0);
      expect(JSON.parse(output.stdout.join(''))).toMatchObject({
        ok: true,
        data: { dataRoot: expectedDataRoot, configCreated: true },
      });
      expect((await stat(expectedDataRoot)).isDirectory()).toBe(true);
      expect(output.stderr).toEqual([]);
    } finally {
      await root.cleanup();
    }
  });

  it('initializes idempotently without overwriting config and reports optional model degradation', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-init-');
    const dataRoot = path.join(root.path, '中文 数据');
    try {
      const firstOutput = memoryIo();
      const firstExit = await runLocalCli({
        argv: ['--json', '--data-root', dataRoot, 'init'],
        io: firstOutput.io,
        environment: {},
        cwd: root.path,
      });
      expect(firstExit).toBe(0);
      const initialized = JSON.parse(firstOutput.stdout.join('')) as {
        readonly data: {
          readonly dataRoot: string;
          readonly configCreated: boolean;
          readonly companies: number;
          readonly sources: number;
          readonly bootstrap: {
            readonly defaultResumeTaskId: string | null;
            readonly sourceSyncTaskIds: readonly string[];
            readonly schedules: number;
          };
        };
      };
      expect(initialized).toMatchObject({
        ok: true,
        data: {
          dataRoot,
          configCreated: true,
          companies: 10,
          sources: 13,
          bootstrap: {
            defaultResumeTaskId: null,
            schedules: 14,
          },
        },
      });
      expect(initialized.data.bootstrap.sourceSyncTaskIds).toHaveLength(13);
      expect(
        initialized.data.bootstrap.sourceSyncTaskIds.every((id) => typeof id === 'string'),
      ).toBe(true);

      const configPath = path.join(dataRoot, 'config.json');
      await writeFile(configPath, '{"logLevel":"error"}\n');
      const secondOutput = memoryIo();
      expect(
        await runLocalCli({
          argv: ['--json', '--data-root', dataRoot, 'init'],
          io: secondOutput.io,
          environment: {},
          cwd: root.path,
        }),
      ).toBe(0);
      expect(JSON.parse(secondOutput.stdout.join(''))).toMatchObject({
        data: { configCreated: false, companies: 10, sources: 13 },
      });
      await expect(readFile(configPath, 'utf8')).resolves.toBe('{"logLevel":"error"}\n');

      const doctorOutput = memoryIo();
      expect(
        await runLocalCli({
          argv: ['--json', '--data-root', dataRoot, 'doctor'],
          io: doctorOutput.io,
          environment: {},
          cwd: root.path,
        }),
      ).toBe(4);
      const doctor = JSON.parse(doctorOutput.stdout.join('')) as {
        readonly ok: boolean;
        readonly data: { readonly status: string; readonly checks: { readonly status: string }[] };
      };
      expect(doctor).toMatchObject({ ok: true, data: { status: 'degraded' } });
      expect(doctor.data.checks.map((check) => check.status)).toEqual([
        'healthy',
        'healthy',
        'healthy',
        'degraded',
      ]);
      expect(doctorOutput.stderr).toEqual([]);
    } finally {
      await root.cleanup();
    }
  });
});
