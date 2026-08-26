import { createTemporaryDataRoot } from '@jobhunter/testkit';
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

describe('source and task commands', () => {
  it('lists sources and manages a queued source synchronization', async () => {
    const root = await createTemporaryDataRoot('jobhunter-cli-source-');
    const dataRoot = path.join(root.path, '中文 数据');
    try {
      expect((await command(dataRoot, ['init'])).exitCode).toBe(0);
      const listed = await command(dataRoot, ['source', 'list']);
      expect(listed.exitCode).toBe(0);
      expect(listed.stderr).toBe('');
      expect(listed.body).toMatchObject({ ok: true });
      expect(Array.isArray((listed.body as { data?: { sources?: unknown } }).data?.sources)).toBe(
        true,
      );

      const synchronized = await command(dataRoot, ['source', 'sync', 'tencent-social']);
      expect(synchronized.exitCode).toBe(0);
      const taskId = (
        synchronized.body as { data: { tasks: readonly { id: string; status: string }[] } }
      ).data.tasks[0]?.id;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/u);

      const tasks = await command(dataRoot, ['task', 'list', '--status', 'pending']);
      expect(tasks.body).toMatchObject({ ok: true });
      const pendingTasks = (tasks.body as { data?: { tasks?: readonly { id: string }[] } }).data
        ?.tasks;
      expect(pendingTasks?.some((task) => task.id === taskId)).toBe(true);
      expect((await command(dataRoot, ['task', 'show', taskId ?? 'missing'])).exitCode).toBe(0);
      expect((await command(dataRoot, ['task', 'cancel', taskId ?? 'missing'])).body).toMatchObject(
        {
          ok: true,
          data: { kind: 'cancelled' },
        },
      );

      const missing = await command(dataRoot, [
        'task',
        'show',
        '018f0000-0000-7000-8000-000000009999',
      ]);
      expect(missing.exitCode).toBe(3);
      expect(missing.body).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
      expect(missing.stderr).toBe('');
    } finally {
      await root.cleanup();
    }
  });
});
