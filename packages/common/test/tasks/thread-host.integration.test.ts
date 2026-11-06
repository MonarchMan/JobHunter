import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { createTemporaryDataRoot } from '../../src/testing/index.js';
import { acquireTaskServiceLock } from '../../src/persistence/task-service-lock.js';

for (const mode of ['graceful', 'forced'] as const) {
  it(`stops all task threads and releases ownership after ${mode} host exit`, async () => {
    const root = await createTemporaryDataRoot('jobhunter-thread-host-');
    const child = spawn(
      process.execPath,
      [
        '--conditions=development',
        '--import',
        'tsx',
        fileURLToPath(new URL('../fixtures/thread-host-main.ts', import.meta.url)),
        root.path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true },
    );
    let errors = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve();
      });
    });
    try {
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Fixture failed: ${errors}`);
        if ((await readFile(path.join(root.path, 'ticks.txt'), 'utf8').catch(() => '')).length >= 2)
          break;
        await delay(25);
      }
      const identity: unknown = JSON.parse(
        await readFile(path.join(root.path, 'executor.json'), 'utf8'),
      );
      expect(identity).toMatchObject({ pid: child.pid, isMainThread: false });
      expect(identity).toHaveProperty('threadId', expect.any(Number));
      const duplicate = acquireTaskServiceLock(root.path);
      duplicate?.();
      expect(duplicate).toBeNull();
      if (mode === 'graceful') child.send('shutdown');
      else child.kill('SIGKILL');
      await exited;
      const count = (await readFile(path.join(root.path, 'ticks.txt'), 'utf8')).length;
      await delay(200);
      expect((await readFile(path.join(root.path, 'ticks.txt'), 'utf8')).length).toBe(count);
      const release = acquireTaskServiceLock(root.path);
      expect(release).not.toBeNull();
      release?.();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      await root.cleanup();
    }
  }, 90_000);
}
