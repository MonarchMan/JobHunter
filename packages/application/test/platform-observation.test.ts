import { expect, it, vi } from 'vitest';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { observePlatformRound } from '../src/platform-observation.js';
import { platformFailure } from '../src/platform-progress.js';
import { PlatformError } from '@jobhunter/platform-core';
import type { TaskRecord } from '../src/tasks/model.js';

/** 合成任务记录只用于本地时钟和隔离测试，不访问浏览器。 */
function task(provider: string, status: TaskRecord['status'], round = 0): TaskRecord {
  return {
    id: new SystemIdGenerator().generate(),
    taskType: `platform.${provider}`,
    status,
    payload: { action: 'next', generation: 1 },
    idempotencyKey: `${provider}:stability:1:${String(round)}:next`,
    concurrencyKey: null,
    scheduleId: null,
    retryOfTaskId: null,
    priority: 0,
    attemptCount: 1,
    maxAttempts: 1,
    availableAt: utcInstant(0),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    cancelRequestedAt: null,
    errorCategory: null,
    errorSummary: null,
    createdAt: utcInstant(0),
    startedAt: null,
    finishedAt: null,
    result: { generation: 1, status: 'available', savedCount: 0, candidates: [], hasMore: false },
  };
}

it.each(['boss', 'zhilian', '51job', 'liepin'] as const)(
  '独立观察 %s 超过90秒仍可完成，不重复详情或末批',
  async (provider) => {
    const current = task(provider, 'pending');
    const rows = [task(provider === 'boss' ? 'zhilian' : 'boss', 'failed')];
    let now = 0;
    const enqueue = vi.fn(() => {
      rows.push(current);
      return { kind: 'enqueued' as const, task: current };
    });
    const cancel = vi.fn();
    const input = {
      provider,
      generation: 1,
      round: 0,
      deadline: 180000,
      tasks: {
        enqueue,
        cancel,
        get: () => (now > 90000 ? { ...current, status: 'succeeded' as const } : current),
        list: ({ taskType }: { taskType?: string }) =>
          rows.filter((row) => row.taskType === taskType),
      },
      connection: () => ({ generation: 1, status: 'available' }),
      verifySaved: vi.fn(),
      now: () => now,
      wait: () => {
        now += 60000;
        return Promise.resolve();
      },
    };
    expect(await observePlatformRound(input)).toMatchObject({
      provider,
      status: 'exhausted',
      saved: 0,
      detailVerified: false,
    });
    expect(now).toBe(120000);
    expect(cancel).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: `platform.${provider}`,
        payload: { action: 'next', generation: 1 },
      }),
    );
    rows[1] = { ...current, status: 'succeeded' };
    await expect(observePlatformRound({ ...input, round: 1 })).resolves.toMatchObject({
      status: 'exhausted',
    });
    await expect(observePlatformRound(input)).resolves.toMatchObject({ status: 'exhausted' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  },
);

it('截止只取消本平台任务，失败前轮只阻止本平台', async () => {
  const current = task('boss', 'running');
  const cancel = vi.fn();
  const enqueue = vi.fn();
  const input = {
    provider: 'boss' as const,
    generation: 1,
    round: 0,
    deadline: 10,
    tasks: { enqueue, cancel, get: () => current, list: () => [current] },
    connection: () => ({ generation: 1, status: 'available' }),
    verifySaved: vi.fn(),
    now: () => 11,
  };
  await expect(observePlatformRound(input)).rejects.toThrow('deadline');
  expect(cancel).toHaveBeenCalledExactlyOnceWith(current.id);
  await expect(observePlatformRound({ ...input, round: 1 })).rejects.toThrow(
    'Previous observation',
  );
  expect(enqueue).not.toHaveBeenCalled();
});

it('错误投影不输出动态文本、未知原因和非整数业务码', () => {
  const error = new PlatformError('network_error', Number.NaN, 'cookie=secret');
  error.message = 'https://private/?token=secret';
  expect(platformFailure(error, false)).toEqual({
    category: 'network_error',
    businessCode: null,
    reason: null,
  });
  expect(
    platformFailure(new PlatformError('parse_changed', null, 'detail_identity'), false),
  ).toMatchObject({ reason: 'detail_identity' });
  expect(platformFailure(error, true)).toMatchObject({ category: 'cancelled', reason: null });
});
