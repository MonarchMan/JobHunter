import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startCentralTaskService } from '../../src/tasks/service-host.js';
import {
  ensureTaskService,
  requestTaskService,
  stopTaskService,
} from '../../src/tasks/service-client.js';
import { setTimeout as delay } from 'node:timers/promises';

const roots: string[] = [];
const services: { close(): Promise<void>; finished: Promise<void> }[] = [];
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
  start: () => Promise<Awaited<ReturnType<typeof startCentralTaskService>>>;
  assembled: () => number;
  closed: () => number;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'jh-service-'));
  roots.push(root);
  const input = { dataRoot: root, configuration: 'fixture-v1' };
  let assembled = 0;
  let closed = 0;
  const start = async (): Promise<Awaited<ReturnType<typeof startCentralTaskService>>> => {
    const service = await startCentralTaskService({
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

describe('central task service lifecycle', () => {
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
    const service = await startCentralTaskService({
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
    const stopping = stopTaskService({ ...f.input, configuration: 'changed-config' }).then(() => {
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
          fileURLToPath(new URL('../fixtures/task-service-process.ts', import.meta.url)),
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
      await requestTaskService({ ...input, method: 'shutdown' });
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
    let restarted = false;
    await expect(
      ensureTaskService({
        ...f.input,
        configuration: 'different',
        start: () => {
          restarted = true;
        },
      }),
    ).rejects.toMatchObject({ code: 'incompatible' });
    expect(restarted).toBe(false);
  });

  it('does not stop the service when a client aborts and can restart after explicit shutdown', async () => {
    const f = await fixture();
    const service = await f.start();
    await expect(
      requestTaskService({ ...f.input, method: 'ping', signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();
    await expect(requestTaskService({ ...f.input, method: 'ping' })).resolves.toBeDefined();
    await requestTaskService({ ...f.input, method: 'shutdown' });
    if (!service) throw new Error('Service failed to start');
    await service.finished;
    expect(f.closed()).toBe(1);
    expect(await f.start()).not.toBeNull();
  });

  it('isolates different data roots and starts only when no compatible service exists', async () => {
    const first = await fixture();
    const second = await fixture();
    await Promise.all([first.start(), second.start()]);
    await ensureTaskService({
      ...first.input,
      start: () => {
        throw new Error('Must not restart');
      },
    });
    expect(first.assembled()).toBe(1);
    expect(second.assembled()).toBe(1);
  });
});
