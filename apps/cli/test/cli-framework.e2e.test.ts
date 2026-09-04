import type {
  EnqueueTaskResult,
  SourceChannelOverview,
  SourceOverview,
  TaskRecord,
} from '@jobhunter/application';
import { parseId, utcInstant } from '@jobhunter/domain';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  cliExitCode,
  cliOutputJsonSchema,
  runCli,
  type CliContainer,
  type CliIo,
} from '../src/index.js';
import { describe, expect, it, vi } from 'vitest';

/** 构造测试输入或执行断言的辅助逻辑。 */
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

/** 构造测试输入或执行断言的辅助逻辑。 */
function container(get: () => Readonly<Record<string, string>> = () => ({ app: 'test' })): {
  readonly value: CliContainer;
  readonly close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn(() => Promise.resolve());
  return { value: { version: { get }, close } satisfies CliContainer, close };
}

describe('CLI framework', () => {
  it('renders human output and closes the container', async () => {
    const output = memoryIo();
    const fixture = container();
    await expect(
      runCli({ argv: ['version'], container: fixture.value, io: output.io }),
    ).resolves.toBe(cliExitCode.success);
    expect(output.stdout.join('')).toBe('app: test\n');
    expect(output.stderr).toEqual([]);
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it('keeps JSON stdout machine-readable and stderr empty on success', async () => {
    const output = memoryIo();
    const fixture = container();
    const exitCode = await runCli({
      argv: ['--json', 'version'],
      container: fixture.value,
      io: output.io,
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toEqual({
      ok: true,
      data: { versions: { app: 'test' } },
    });
    expect(output.stderr).toEqual([]);
  });

  it('maps usage and internal failures to stable exits without leaking errors', async () => {
    const usageOutput = memoryIo();
    expect(
      await runCli({ argv: ['missing'], container: container().value, io: usageOutput.io }),
    ).toBe(cliExitCode.usage);
    expect(usageOutput.stderr.join('')).toContain('USAGE_ERROR');

    const internalOutput = memoryIo();
    const internal = container(() => {
      throw new Error('private implementation detail');
    });
    expect(
      await runCli({
        argv: ['--json', 'version'],
        container: internal.value,
        io: internalOutput.io,
      }),
    ).toBe(cliExitCode.internal);
    const body = internalOutput.stdout.join('');
    expect(JSON.parse(body)).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(body).not.toContain('private implementation detail');
  });

  it('starts and stops the composed worker with progress on stderr', async () => {
    const output = memoryIo();
    const start = vi.fn(() => Promise.resolve());
    const fixture: CliContainer = {
      version: { get: () => ({ app: 'test' }) },
      worker: { start },
      close: () => Promise.resolve(),
    };

    await expect(
      runCli({ argv: ['worker', 'start'], container: fixture, io: output.io }),
    ).resolves.toBe(cliExitCode.success);
    expect(start).toHaveBeenCalledOnce();
    expect(output.stdout.join('')).toBe('Worker 已停止。\n');
    expect(output.stderr.join('')).toContain('Worker 已启动');
  });

  it('maps a completed partial source synchronization to exit code 4', async () => {
    const output = memoryIo();
    const sourceId = parseId('018f0000-0000-7000-8000-000000000202', 'JobSource');
    const companyId = parseId('018f0000-0000-7000-8000-000000000101', 'Company');
    const channelId = parseId('018f0000-0000-7000-8200-000000010103', 'SourceChannel');
    const task: TaskRecord = {
      id: parseId('018f0000-0000-7000-8000-000000000302', 'Task'),
      taskType: 'source.sync',
      payload: { sourceId, trigger: 'manual' },
      status: 'succeeded',
      priority: 0,
      idempotencyKey: 'sync-fixture',
      concurrencyKey: `source-sync:${sourceId}`,
      scheduleId: null,
      retryOfTaskId: null,
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: utcInstant(1),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      cancelRequestedAt: null,
      errorCategory: null,
      errorSummary: null,
      createdAt: utcInstant(1),
      startedAt: utcInstant(2),
      finishedAt: utcInstant(3),
    };
    const overview: SourceOverview = {
      id: sourceId,
      companyId,
      channelId,
      channel: 'social',
      companyName: '腾讯',
      slug: 'tencent-social',
      adapterKey: 'tencent.social',
      coverageRole: 'required',
      enabled: true,
      effectiveEnabled: true,
      supportStatus: 'supported',
      healthStatus: 'degraded',
      lastRun: {
        id: 'run-fixture',
        status: 'partial',
        coverage: 'partial',
        startedAt: utcInstant(1),
        finishedAt: utcInstant(2),
      },
    };
    const channel: SourceChannelOverview = {
      id: channelId,
      companyId,
      companyName: '腾讯',
      slug: 'tencent-social',
      channel: 'social',
      enabled: true,
      effectiveEnabled: true,
      supportNote: null,
      supportStatus: 'supported',
      healthStatus: 'degraded',
      sources: [overview],
    };
    const queued: EnqueueTaskResult = { kind: 'enqueued', task };
    const fixture: CliContainer = {
      version: { get: () => ({ app: 'test' }) },
      source: {
        list: () => [channel],
        sync: () => [queued],
        wait: () => Promise.resolve(task),
      },
      close: () => Promise.resolve(),
    };

    await expect(
      runCli({
        argv: ['--json', 'source', 'sync', 'tencent-social', '--wait'],
        container: fixture,
        io: output.io,
      }),
    ).resolves.toBe(cliExitCode.partial);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ ok: true });
    expect(output.stderr.join('')).toContain('Ctrl+C');
  });

  it('maps a final failed background task to exit code 5', async () => {
    const output = memoryIo();
    const sourceId = parseId('018f0000-0000-7000-8000-000000000202', 'JobSource');
    const companyId = parseId('018f0000-0000-7000-8000-000000000101', 'Company');
    const channelId = parseId('018f0000-0000-7000-8200-000000010103', 'SourceChannel');
    const failed: TaskRecord = {
      id: parseId('018f0000-0000-7000-8000-000000000303', 'Task'),
      taskType: 'source.sync',
      payload: { sourceId, trigger: 'manual' },
      status: 'failed',
      priority: 0,
      idempotencyKey: 'failed-fixture',
      concurrencyKey: `source-sync:${sourceId}`,
      scheduleId: null,
      retryOfTaskId: null,
      attemptCount: 3,
      maxAttempts: 3,
      availableAt: utcInstant(1),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      cancelRequestedAt: null,
      errorCategory: 'permanent',
      errorSummary: 'safe failure',
      createdAt: utcInstant(1),
      startedAt: utcInstant(2),
      finishedAt: utcInstant(3),
    };
    const overview: SourceOverview = {
      id: sourceId,
      companyId,
      channelId,
      channel: 'social',
      companyName: '腾讯',
      slug: 'tencent-social',
      adapterKey: 'tencent.social',
      coverageRole: 'required',
      enabled: true,
      effectiveEnabled: true,
      supportStatus: 'supported',
      healthStatus: 'unhealthy',
      lastRun: null,
    };
    const channel: SourceChannelOverview = {
      id: channelId,
      companyId,
      companyName: '腾讯',
      slug: 'tencent-social',
      channel: 'social',
      enabled: true,
      effectiveEnabled: true,
      supportNote: null,
      supportStatus: 'supported',
      healthStatus: 'unhealthy',
      sources: [overview],
    };
    const fixture: CliContainer = {
      version: { get: () => ({ app: 'test' }) },
      source: {
        list: () => [channel],
        sync: () => [{ kind: 'enqueued', task: failed }],
        wait: () => Promise.resolve(failed),
      },
      close: () => Promise.resolve(),
    };
    await expect(
      runCli({
        argv: ['--json', 'source', 'sync', 'tencent-social', '--wait'],
        container: fixture,
        io: output.io,
      }),
    ).resolves.toBe(cliExitCode.taskFailed);
  });

  it('keeps the runtime and documented JSON schemas identical', async () => {
    const output = memoryIo();
    const fixture = container();
    expect(
      await runCli({
        argv: ['--json', 'schema'],
        container: fixture.value,
        io: output.io,
      }),
    ).toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toEqual({
      ok: true,
      data: { schema: cliOutputJsonSchema },
    });
    const documented = JSON.parse(
      await readFile(path.resolve('docs', 'schemas', 'cli-output.schema.json'), 'utf8'),
    ) as unknown;
    expect(documented).toEqual(cliOutputJsonSchema);
  });

  it('shows defaults, units, dangerous restore semantics and command examples in help', async () => {
    const listOutput = memoryIo();
    expect(
      await runCli({
        argv: ['job', 'list', '--help'],
        container: container().value,
        io: listOutput.io,
      }),
    ).toBe(0);
    expect(listOutput.stdout.join('')).toContain('每页数量 1..100 (default: "50")');
    expect(listOutput.stdout.join('')).toContain('示例：');

    const restoreOutput = memoryIo();
    expect(
      await runCli({
        argv: ['backup', 'restore', '--help'],
        container: container().value,
        io: restoreOutput.io,
      }),
    ).toBe(0);
    expect(restoreOutput.stdout.join('')).toContain('默认仅生成恢复计划');
    expect(restoreOutput.stdout.join('')).toContain('--confirm <token>');
  });
});
