import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runLocalCli } from '../src/local-runner.js';
import { acquireTaskServiceLock } from '@jobhunter/common/task-host-runtime';

it('exports a bounded safe timeline as JSON while a host owns the data directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jobhunter-cli-logs-'));
  const release = acquireTaskServiceLock(root, 'web');
  try {
    await mkdir(join(root, 'logs'), { recursive: true });
    await writeFile(
      join(root, 'logs/jobhunter.log'),
      JSON.stringify({
        time: '2026-11-10T00:00:00Z',
        level: 50,
        event: 'fixture',
        taskId: 'task-1',
        token: 'private',
      }) + '\n',
    );
    let stdout = '',
      stderr = '';
    const code = await runLocalCli({
      argv: ['--json', '--data-root', root, 'logs', '--task', 'task-1'],
      workspaceRoot: root,
      environment: {},
      io: {
        stdout: {
          write(value) {
            stdout += value;
          },
        },
        stderr: {
          write(value) {
            stderr += value;
          },
        },
      },
    });
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const result = JSON.parse(stdout) as { data: { events: unknown[] } };
    expect(result.data.events).toHaveLength(1);
    expect(stdout).not.toContain('private');
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});
