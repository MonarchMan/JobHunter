import { runLocalCli, type CliIo } from '../src/index.js';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { readFile, writeFile } from 'node:fs/promises';
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
      expect(JSON.parse(firstOutput.stdout.join(''))).toMatchObject({
        ok: true,
        data: { dataRoot, configCreated: true, companies: 10, sources: 10 },
      });

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
        data: { configCreated: false, companies: 10, sources: 10 },
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
