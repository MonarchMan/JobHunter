import { taskServiceRequestSchema } from '../../src/tasks/host-bridge-protocol.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTaskHostBridge } from '../../src/tasks/host-bridge.js';
import { requestTaskService } from '../../src/tasks/host-bridge-client.js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireTaskServiceLock,
  readTaskHostOwner,
} from '../../src/persistence/task-service-lock.js';

const roots: string[] = [];
const services: { close(): Promise<void>; finished: Promise<void> }[] = [];
it('keeps owner diagnostics separate from the authoritative process lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jh-owner-'));
  roots.push(root);
  const release = acquireTaskServiceLock(root, 'web');
  if (!release) throw new Error('Expected exclusive owner');
  try {
    expect(readTaskHostOwner(root)).toMatchObject({ kind: 'web', pid: process.pid });
    const duplicate = acquireTaskServiceLock(root, 'cli');
    duplicate?.();
    expect(duplicate).toBeNull();
  } finally {
    release();
  }
  expect(readTaskHostOwner(root)).toBeNull();
});
afterEach(async () => {
  await Promise.all(
    services.splice(0).map(async (service) => {
      await service.close();
      await service.finished;
    }),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 服务夹具只等待生命周期信号，不启动业务采集或模型调用。 */
async function fixture(): Promise<{
  input: { dataRoot: string; configuration: string };
  start: () => Promise<Awaited<ReturnType<typeof startTaskHostBridge>>>;
  assembled: () => number;
  closed: () => number;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'jh-service-'));
  roots.push(root);
  const input = { dataRoot: root, configuration: 'fixture-v1' };
  let assembled = 0;
  let closed = 0;
  const start = async (): Promise<Awaited<ReturnType<typeof startTaskHostBridge>>> => {
    const service = await startTaskHostBridge({
      ...input,
      createRuntime: () => {
        assembled++;
        return {
          run: (signal: AbortSignal) =>
            new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else
                signal.addEventListener(
                  'abort',
                  () => {
                    resolve();
                  },
                  { once: true },
                );
            }),
          request: (_method: string, value: unknown) => value,
          close: () => {
            closed++;
            return Promise.resolve();
          },
        };
      },
    });
    if (service) services.push(service);
    return service;
  };
  return { input, start, assembled: () => assembled, closed: () => closed };
}

describe('host command bridge lifecycle', () => {
  it('allows explicit configuration replacement only after executor cleanup releases ownership', async () => {
    const f = await fixture();
    let releaseCleanup: () => void = () => undefined;
    let cleanupStarted: () => void = () => undefined;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const started = new Promise<void>((resolve) => {
      cleanupStarted = resolve;
    });
    const service = await startTaskHostBridge({
      ...f.input,
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
        close: () => {
          cleanupStarted();
          return cleanup;
        },
      }),
    });
    if (!service) throw new Error('Expected service');
    services.push(service);
    let stopped = false;
    const stopping = service.close().then(() => {
      stopped = true;
    });
    try {
      await started;
      await delay(150);
      expect(stopped).toBe(false);
      expect(await f.start()).toBeNull();
    } finally {
      releaseCleanup();
      await stopping;
    }
    expect(stopped).toBe(true);
    expect(await f.start()).not.toBeNull();
  });

  it('elects one process during cold startup and recovers the lock and socket after a crash', async () => {
    const f = await fixture();
    const children: ChildProcess[] = [];
    const exits: Promise<void>[] = [];
    const launch = (): Promise<{ child: ChildProcess; ready: boolean }> =>
      new Promise((resolve, reject) => {
        const child = fork(
          fileURLToPath(new URL('../fixtures/host-bridge-process.ts', import.meta.url)),
          [f.input.dataRoot],
          {
            execArgv: ['--import', 'tsx', '--conditions=development'],
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          },
        );
        children.push(child);
        exits.push(
          new Promise<void>((done) => {
            child.once('exit', () => {
              done();
            });
          }),
        );
        child.once('error', reject);
        child.once('message', (message: unknown) => {
          if (!message || typeof message !== 'object' || !('ready' in message)) {
            reject(new Error('Invalid fixture readiness'));
            return;
          }
          resolve({ child, ready: message.ready === true });
        });
      });
    try {
      const candidates = await Promise.all(Array.from({ length: 4 }, launch));
      const winners = candidates.filter((candidate) => candidate.ready);
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      if (!winner) throw new Error('No service owner');
      const input = { ...f.input, configuration: 'process-fixture' };
      await expect(requestTaskService({ ...input, method: 'ping' })).resolves.toEqual({
        pid: winner.child.pid,
      });
      const exited = new Promise<void>((resolve) => {
        winner.child.once('exit', () => {
          resolve();
        });
      });
      winner.child.kill('SIGKILL');
      await exited;
      const replacement = await launch();
      expect(replacement.ready).toBe(true);
      await expect(requestTaskService({ ...input, method: 'ping' })).resolves.toEqual({
        pid: replacement.child.pid,
      });
      replacement.child.send('shutdown');
      await Promise.all(exits);
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await Promise.all(exits);
    }
  });
  it('assembles exactly one runtime during concurrent startup', async () => {
    const f = await fixture();
    const candidates = await Promise.all(Array.from({ length: 8 }, () => f.start()));
    expect(candidates.filter(Boolean)).toHaveLength(1);
    expect(f.assembled()).toBe(1);
    expect(
      await requestTaskService({ ...f.input, method: 'query', value: { task: 'fixture' } }),
    ).toEqual({ task: 'fixture' });
    expect(f.closed()).toBe(0);
  });

  it('shares the service across a symlink alias and rejects incompatible configuration', async () => {
    const f = await fixture();
    await f.start();
    const alias = `${f.input.dataRoot}-alias`;
    roots.push(alias);
    await symlink(f.input.dataRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      requestTaskService({ ...f.input, dataRoot: alias, method: 'ping' }),
    ).resolves.toMatchObject({ pid: process.pid });
    await expect(
      requestTaskService({ ...f.input, configuration: 'different', method: 'ping' }),
    ).rejects.toMatchObject({ code: 'incompatible' });
  });

  it('does not stop the service when a client aborts and can restart after explicit shutdown', async () => {
    const f = await fixture();
    const service = await f.start();
    await expect(
      requestTaskService({ ...f.input, method: 'ping', signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();
    await expect(requestTaskService({ ...f.input, method: 'ping' })).resolves.toBeDefined();
    await service?.close();
    if (!service) throw new Error('Service failed to start');
    await service.finished;
    expect(f.closed()).toBe(1);
    expect(await f.start()).not.toBeNull();
  });

  it('isolates different data roots and starts only when no compatible service exists', async () => {
    const first = await fixture();
    const second = await fixture();
    await Promise.all([first.start(), second.start()]);
    await expect(requestTaskService({ ...first.input, method: 'ping' })).resolves.toBeDefined();
    expect(first.assembled()).toBe(1);
    expect(second.assembled()).toBe(1);
  });
});

it('rejects the removed remote daemon shutdown command', () => {
  expect(
    taskServiceRequestSchema.safeParse({
      protocol: 3,
      id: '018f0000-0000-7000-8000-000000000001',
      configuration: 'fixture',
      method: 'shutdown',
    }).success,
  ).toBe(false);
});
