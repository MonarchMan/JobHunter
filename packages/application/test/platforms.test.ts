import { expect, it, vi, type Mock } from 'vitest';
import {
  PlatformError,
  PlatformTargetSelectionRequired,
  type PlatformJobDetail,
  type PlatformSession,
} from '@jobhunter/platform-core';
import {
  bossCommandSchema,
  BossPlatformService,
  type BossResult,
  type PlatformRepository,
} from '../src/platforms.js';
import { platformProgressSchema } from '../src/platform-progress.js';

/** 批次测试的可观察端口，用于验证请求和提交顺序。 */
interface BatchFixture {
  repository: Omit<PlatformRepository, 'recordProgress' | 'setStatus'> & {
    recordProgress: Mock<PlatformRepository['recordProgress']>;
    setStatus: Mock<PlatformRepository['setStatus']>;
  };
  session: {
    resume: Mock<NonNullable<PlatformSession['resume']>>;
    readNext: Mock<PlatformSession['readNext']>;
    readDetail: Mock<PlatformSession['readDetail']>;
    disconnect: Mock<PlatformSession['disconnect']>;
  };
  save: Mock<PlatformRepository['save']>;
  controller: AbortController;
  events: string[];
  detail: (id: string) => PlatformJobDetail;
  connect: () => Promise<BossResult>;
  next: () => Promise<BossResult>;
  resume: (sourceTaskId?: string, taskId?: string) => Promise<BossResult>;
  acquire: (expectedGeneration?: number) => Promise<BossResult>;
}

/** 有界批次替身，不接触浏览器或真实平台。 */
function batchFixture(now: () => number = Date.now): BatchFixture {
  let generation = 0;
  const events: string[] = [];
  const detail = (id: string): PlatformJobDetail => ({
    externalJobId: id,
    externalCompanyId: 'company',
    title: '工程师',
    company: '测试公司',
    city: '上海',
    salary: '',
    experience: '',
    education: '',
    sourceUrl: `https://www.zhipin.com/job_detail/${id}.html`,
    description: '完整职位正文',
  });
  const save = vi.fn<PlatformRepository['save']>((value) => {
    events.push(`save:${value.externalJobId}`);
    return value.externalJobId;
  });
  const repository: BatchFixture['repository'] = {
    reset: () => ++generation,
    generation: () => generation,
    setStatus: vi.fn(),
    save,
    recordProgress: vi.fn(),
  };
  const session = {
    resume: vi.fn<NonNullable<PlatformSession['resume']>>(() => Promise.resolve()),
    readNext: vi.fn<PlatformSession['readNext']>(() =>
      Promise.resolve({ candidates: ['1', '2', '3'].map(detail), hasMore: true }),
    ),
    readDetail: vi.fn<PlatformSession['readDetail']>((id: string) => {
      events.push(`detail:${id}`);
      return Promise.resolve(detail(id));
    }),
    disconnect: vi.fn(),
  };
  const service = new BossPlatformService(
    { connect: () => Promise.resolve(session) },
    repository,
    now,
  );
  const controller = new AbortController();
  const connect = (): Promise<BossResult> =>
    service.execute(
      { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'test' },
      'task',
      controller.signal,
    );
  const next = (): Promise<BossResult> =>
    service.execute({ action: 'next', generation }, 'task', controller.signal);
  const resume = (sourceTaskId = 'task', taskId = 'resume-task'): Promise<BossResult> =>
    service.execute(
      { action: 'resume', generation, sourceTaskId, browserRecovered: true },
      taskId,
      controller.signal,
    );
  const acquire = (expectedGeneration = generation): Promise<BossResult> =>
    service.execute(
      { action: 'acquire', generation: expectedGeneration },
      'task',
      controller.signal,
    );
  return { repository, session, save, controller, events, detail, connect, next, resume, acquire };
}

it('日常获取自动连接并保存一批，后续获取复用原代次且不重复连接', async () => {
  const fixture = batchFixture();
  await expect(fixture.acquire()).resolves.toMatchObject({ savedCount: 3, generation: 1 });
  await expect(fixture.acquire()).resolves.toMatchObject({ savedCount: 3, generation: 1 });
  expect(fixture.session.disconnect).not.toHaveBeenCalled();
  expect(fixture.session.readNext).toHaveBeenCalledTimes(2);
  expect(fixture.repository.generation()).toBe(1);
});

it('日常获取拒绝旧代次，37 冻结后不能通过自动连接重置工作集', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  await expect(fixture.acquire(99)).rejects.toBeInstanceOf(PlatformError);
  expect(fixture.session.readNext).not.toHaveBeenCalled();
  fixture.session.readDetail.mockRejectedValueOnce(new PlatformError('access_blocked', 37));
  await expect(fixture.acquire()).rejects.toMatchObject({ businessCode: 37 });
  await expect(fixture.acquire()).rejects.toBeInstanceOf(PlatformError);
  expect(fixture.session.readNext).toHaveBeenCalledTimes(1);
  expect(fixture.session.disconnect).not.toHaveBeenCalled();
  expect(fixture.repository.generation()).toBe(1);
});

it('页面歧义先返回选择结果，确认后才读取一批；连接异常不发列表请求', async () => {
  const fixture = batchFixture();
  const provider = {
    connect: vi
      .fn()
      .mockRejectedValueOnce(
        new PlatformTargetSelectionRequired([
          { id: 'first', label: 'BOSS 推荐页 · 第 1 个页面' },
          { id: 'second', label: 'BOSS 推荐页 · 第 2 个页面' },
        ]),
      )
      .mockResolvedValue(fixture.session),
  };
  const service = new BossPlatformService(provider, fixture.repository);
  const signal = new AbortController().signal;
  await expect(
    service.execute({ action: 'acquire', generation: 0 }, 'choose', signal),
  ).resolves.toMatchObject({
    status: 'selection_required',
    targets: [{ id: 'first' }, { id: 'second' }],
  });
  expect(fixture.session.readNext).not.toHaveBeenCalled();
  const generation = fixture.repository.generation();
  await expect(
    service.execute({ action: 'acquire', generation, targetId: 'second' }, 'fetch', signal),
  ).resolves.toMatchObject({ savedCount: 3 });
  expect(provider.connect).toHaveBeenLastCalledWith(
    { action: 'connect', targetId: 'second' },
    signal,
  );
  service.close();
  provider.connect.mockRejectedValueOnce(
    new PlatformError('session_unavailable', null, 'browser_not_found'),
  );
  await expect(
    service.execute(
      { action: 'acquire', generation: fixture.repository.generation() },
      'missing',
      signal,
    ),
  ).rejects.toMatchObject({ reason: 'browser_not_found' });
  expect(fixture.session.readNext).toHaveBeenCalledTimes(1);
});

it('显式恢复只处理未提交候选，原列表和已保存详情不再请求', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  fixture.session.readDetail.mockImplementation((id) =>
    id === '2'
      ? Promise.reject(new PlatformError('access_blocked', 37, 'security_check'))
      : Promise.resolve(fixture.detail(id)),
  );
  await expect(fixture.next()).rejects.toMatchObject({ businessCode: 37 });
  fixture.session.resume.mockRejectedValueOnce(
    new PlatformError('session_unavailable', null, 'context_unchanged'),
  );
  await expect(fixture.resume()).rejects.toMatchObject({ reason: 'context_unchanged' });
  expect(fixture.session.readDetail).toHaveBeenCalledTimes(2);
  fixture.session.readDetail.mockImplementation((id) => Promise.resolve(fixture.detail(id)));
  await expect(fixture.resume()).resolves.toMatchObject({
    savedCount: 2,
    resumedFromTaskId: 'task',
    candidates: [{ externalJobId: '2' }, { externalJobId: '3' }],
  });
  expect(fixture.session.readNext).toHaveBeenCalledTimes(1);
  expect(fixture.session.readDetail.mock.calls.map(([id]) => id)).toEqual(['1', '2', '2', '3']);
  expect(fixture.save.mock.calls.map(([job]) => job.externalJobId)).toEqual(['1', '2', '3']);
  await expect(fixture.resume()).rejects.toMatchObject({ category: 'session_unavailable' });
});

it('恢复再次失败后拒绝旧任务引用，换代不能继续旧批次', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  fixture.session.readDetail.mockRejectedValue(new PlatformError('access_blocked', 37));
  await expect(fixture.next()).rejects.toThrow();
  await expect(fixture.resume()).rejects.toThrow();
  await expect(fixture.resume()).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(fixture.session.resume).toHaveBeenCalledTimes(1);
  await fixture.connect();
  await expect(fixture.resume()).rejects.toMatchObject({ category: 'session_unavailable' });
});

it.each(['expired', 'cancelled'] as const)('恢复 %s 时不请求剩余详情', async (mode) => {
  let now = 1000;
  const fixture = batchFixture(() => now);
  await fixture.connect();
  fixture.session.readDetail.mockRejectedValue(new PlatformError('access_blocked', 37));
  await expect(fixture.next()).rejects.toThrow();
  if (mode === 'expired') now += 600_000;
  else fixture.controller.abort();
  await expect(fixture.resume()).rejects.toThrow();
  expect(fixture.session.resume).not.toHaveBeenCalled();
  expect(fixture.session.readDetail).toHaveBeenCalledTimes(1);
});

it('恢复命令必须引用稳定任务 ID 并明确确认官网正常', () => {
  const command = {
    action: 'resume',
    generation: 1,
    sourceTaskId: '550e8400-e29b-41d4-a716-446655440000',
    browserRecovered: true,
  };
  expect(bossCommandSchema.safeParse(command).success).toBe(true);
  expect(bossCommandSchema.safeParse({ ...command, browserRecovered: false }).success).toBe(false);
  expect(bossCommandSchema.safeParse({ ...command, sourceTaskId: 'not-a-task' }).success).toBe(
    false,
  );
});

it('多段恢复仅补剩余职位，每条只提交一次，不重复读取列表', async () => {
  const f = batchFixture();
  await f.connect();
  let blocked = '2';
  f.session.readDetail.mockImplementation((id) =>
    id === blocked
      ? Promise.reject(new PlatformError('access_blocked', 37))
      : Promise.resolve(f.detail(id)),
  );
  await expect(f.next()).rejects.toThrow();
  blocked = '3';
  await expect(f.resume('task', 'r1')).rejects.toThrow();
  await expect(f.resume('task', 'stale')).rejects.toThrow();
  blocked = '';
  await expect(f.resume('r1', 'r2')).resolves.toMatchObject({
    savedCount: 1,
    resumedFromTaskId: 'r1',
  });
  expect(f.session.readNext).toHaveBeenCalledTimes(1);
  expect(f.session.readDetail.mock.calls.map(([id]) => id)).toEqual(['1', '2', '2', '3', '3']);
  expect(f.save.mock.calls.map(([job]) => job.externalJobId)).toEqual(['1', '2', '3']);
});

it('五次恢复耗尽后拒绝第六次，未更新检查不消耗有效次数', async () => {
  const f = batchFixture();
  await f.connect();
  f.session.readDetail.mockRejectedValue(new PlatformError('access_blocked', 37));
  await expect(f.next()).rejects.toThrow();
  f.session.resume.mockRejectedValueOnce(
    new PlatformError('session_unavailable', null, 'context_unchanged'),
  );
  await expect(f.resume()).rejects.toThrow();
  let source = 'task';
  for (let i = 1; i <= 5; i++) {
    const id = `r${String(i)}`;
    await expect(f.resume(source, id)).rejects.toThrow();
    source = id;
  }
  await expect(f.resume(source, 'r6')).rejects.toThrow();
  expect(f.session.readDetail).toHaveBeenCalledTimes(6);
  expect(f.session.resume).toHaveBeenCalledTimes(6);
});

it('恢复不能延长原批次十分钟期限', async () => {
  let now = 1000;
  const f = batchFixture(() => now);
  await f.connect();
  f.session.readDetail.mockRejectedValue(new PlatformError('access_blocked', 37));
  await expect(f.next()).rejects.toThrow();
  now += 590000;
  await expect(f.resume('task', 'r1')).rejects.toThrow();
  now += 10000;
  await expect(f.resume('r1', 'r2')).rejects.toThrow();
  expect(f.session.resume).toHaveBeenCalledTimes(1);
});

it('恢复中的网络错误不能继续沿用 37 恢复链', async () => {
  const f = batchFixture();
  await f.connect();
  f.session.readDetail.mockRejectedValueOnce(new PlatformError('access_blocked', 37));
  await expect(f.next()).rejects.toThrow();
  f.session.readDetail.mockRejectedValueOnce(new PlatformError('network_error'));
  await expect(f.resume('task', 'r1')).rejects.toMatchObject({ category: 'network_error' });
  await expect(f.resume('r1', 'r2')).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(f.session.resume).toHaveBeenCalledTimes(1);
  expect(f.session.readDetail).toHaveBeenCalledTimes(2);
});

it('显式浏览器模式透传给连接端口，省略时不改变历史命令', async () => {
  const fixture = batchFixture();
  const connect = vi.fn(() => Promise.resolve(fixture.session));
  const service = new BossPlatformService({ connect }, fixture.repository);
  const command = bossCommandSchema.parse({
    action: 'connect',
    portFile: '/fixture/DevToolsActivePort',
    targetId: 'test',
    acquisitionMode: 'browser',
  });
  await service.execute(command, 'task', fixture.controller.signal);
  expect(connect).toHaveBeenCalledWith(command, fixture.controller.signal);
  expect(bossCommandSchema.safeParse({ ...command, acquisitionMode: 'automatic' }).success).toBe(
    false,
  );
  const legacy = bossCommandSchema.parse({
    action: 'connect',
    portFile: '/fixture/DevToolsActivePort',
    targetId: 'test',
  });
  expect(legacy).not.toHaveProperty('acquisitionMode');
});

it('automatically saves one complete batch in serial order without reading another page', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  expect(await fixture.next()).toMatchObject({ savedCount: 3, hasMore: true });
  expect(fixture.events).toEqual([
    'detail:1',
    'save:1',
    'detail:2',
    'save:2',
    'detail:3',
    'save:3',
  ]);
  expect(fixture.session.readNext).toHaveBeenCalledTimes(1);
  expect(fixture.repository.recordProgress).toHaveBeenLastCalledWith(
    'task',
    1,
    expect.objectContaining({ stage: 'complete', total: 3, processed: 3, saved: 3, failure: null }),
    expect.any(Number),
  );
});

it('stops after a detail failure, retains committed jobs and freezes retries without closing CDP', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  fixture.session.readDetail.mockImplementation((id) => {
    if (id === '2') return Promise.reject(new PlatformError('parse_changed'));
    return Promise.resolve(fixture.detail(id));
  });
  await expect(fixture.next()).rejects.toMatchObject({ category: 'parse_changed' });
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(fixture.session.readDetail.mock.calls.map(([id]) => id)).toEqual(['1', '2']);
  await expect(fixture.next()).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(fixture.session.readNext).toHaveBeenCalledTimes(1);
  expect(fixture.session.disconnect).not.toHaveBeenCalled();
  expect(fixture.repository.recordProgress).toHaveBeenLastCalledWith(
    'task',
    1,
    expect.objectContaining({
      stage: 'detail',
      currentExternalJobId: '2',
      total: 3,
      saved: 1,
      failure: { category: 'parse_changed', businessCode: null, reason: null },
    }),
    expect.any(Number),
  );
});

it('详情请求前记录稳定身份，成功后清除检查点且拒绝 URL 和凭据字段', async () => {
  const fixture = batchFixture();
  await fixture.connect();
  fixture.session.readDetail.mockImplementation((id) => {
    expect(fixture.repository.recordProgress.mock.lastCall?.[2]).toMatchObject({
      stage: 'detail',
      currentExternalJobId: id,
    });
    return Promise.resolve(fixture.detail(id));
  });
  const result = await fixture.next();
  expect(result.progress).not.toHaveProperty('currentExternalJobId');
  const progress = result.progress;
  expect(
    platformProgressSchema.safeParse({ ...progress, currentExternalJobId: 'abc_12-~' }).success,
  ).toBe(true);
  for (const id of [
    '',
    'https://www.zhipin.com/job_detail/id.html?securityId=secret',
    'id\ncookie=secret',
    'x'.repeat(513),
  ])
    expect(
      platformProgressSchema.safeParse({ ...progress, currentExternalJobId: id }).success,
    ).toBe(false);
  expect(platformProgressSchema.safeParse({ ...progress, securityId: 'secret' }).success).toBe(
    false,
  );
  expect(platformProgressSchema.safeParse(progress).success).toBe(true);
});

it('断线更新当前代次，旧连接通知和显式关闭不污染新连接', async () => {
  const fixture = batchFixture();
  const listeners: (() => void)[] = [];
  const unsubscribe = vi.fn();
  const provider = {
    connect: () =>
      Promise.resolve({
        ...fixture.session,
        onDisconnected: (listener: () => void) => {
          listeners.push(listener);
          return unsubscribe;
        },
      }),
  };
  const service = new BossPlatformService(provider, fixture.repository);
  const command = {
    action: 'connect' as const,
    portFile: '/fixture/DevToolsActivePort',
    targetId: 'test',
  };
  await service.execute(command, 'first', fixture.controller.signal);
  listeners[0]?.();
  expect(fixture.repository.setStatus).toHaveBeenLastCalledWith(
    1,
    'unavailable',
    expect.any(Number),
  );
  await service.execute(command, 'second', fixture.controller.signal);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  listeners[0]?.();
  expect(fixture.repository.setStatus).toHaveBeenLastCalledWith(2, 'connected', expect.any(Number));
  await expect(
    service.execute({ action: 'next', generation: 2 }, 'next', fixture.controller.signal),
  ).resolves.toMatchObject({ savedCount: 3 });
  service.close();
  listeners[1]?.();
  expect(fixture.repository.setStatus).toHaveBeenLastCalledWith(
    2,
    'disconnected',
    expect.any(Number),
  );
});

it('订阅时已经断线不能宣称连接成功', async () => {
  const fixture = batchFixture();
  const service = new BossPlatformService(
    {
      connect: () =>
        Promise.resolve({
          ...fixture.session,
          onDisconnected: (listener: () => void) => {
            listener();
            return () => undefined;
          },
        }),
    },
    fixture.repository,
  );
  await expect(
    service.execute(
      { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'test' },
      'task',
      fixture.controller.signal,
    ),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(fixture.repository.setStatus).toHaveBeenLastCalledWith(
    1,
    'unavailable',
    expect.any(Number),
  );
});

it.each(['list', 'detail'] as const)(
  '在 %s 等待期间断线拒绝迟到结果，不提交或覆盖不可用状态',
  async (stage) => {
    const fixture = batchFixture();
    let disconnected: (() => void) | undefined;
    const service = new BossPlatformService(
      {
        connect: () =>
          Promise.resolve({
            ...fixture.session,
            onDisconnected: (listener: () => void) => {
              disconnected = listener;
              return () => undefined;
            },
          }),
      },
      fixture.repository,
    );
    await service.execute(
      { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'test' },
      'connect',
      fixture.controller.signal,
    );
    if (stage === 'list')
      fixture.session.readNext.mockImplementation(() => {
        disconnected?.();
        return Promise.resolve({ candidates: [], hasMore: false });
      });
    else
      fixture.session.readDetail.mockImplementation((id) => {
        disconnected?.();
        return Promise.resolve(fixture.detail(id));
      });
    await expect(
      service.execute({ action: 'next', generation: 1 }, 'next', fixture.controller.signal),
    ).rejects.toMatchObject({ category: 'session_unavailable' });
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.repository.setStatus).toHaveBeenLastCalledWith(
      1,
      'unavailable',
      expect.any(Number),
    );
  },
);

it.each(['cancel', 'generation'] as const)(
  'rejects a late detail after %s before saving or requesting more',
  async (mode) => {
    const fixture = batchFixture();
    await fixture.connect();
    fixture.session.readDetail.mockImplementation((id) => {
      if (mode === 'cancel') fixture.controller.abort();
      else fixture.repository.reset(0);
      return Promise.resolve(fixture.detail(id));
    });
    await expect(fixture.next()).rejects.toThrow();
    expect(fixture.save).not.toHaveBeenCalled();
    expect(fixture.session.readDetail).toHaveBeenCalledTimes(1);
  },
);

it('retains CDP after request failure, freezes actions, and closes on explicit disconnect or shutdown', async () => {
  let generation = 0;
  const repository: PlatformRepository = {
    reset: () => ++generation,
    generation: () => generation,
    setStatus: vi.fn(),
    save: () => 'unused',
    recordProgress: vi.fn(),
  };
  const disconnect = vi.fn();
  const readNext = vi.fn().mockRejectedValue(new PlatformError('access_blocked', 37));
  const provider = { connect: vi.fn().mockResolvedValue({ disconnect, readNext }) };
  const service = new BossPlatformService(provider, repository);
  const signal = new AbortController().signal;
  const connect = {
    action: 'connect' as const,
    portFile: '/profile/DevToolsActivePort',
    targetId: 'valid',
  };
  // 1、失败后只冻结，不释放授权或自动重连，重复调用不再访问上游。
  await service.execute(connect, 'task', signal);
  await expect(
    service.execute({ action: 'next', generation }, 'task', signal),
  ).rejects.toMatchObject({ category: 'access_blocked' });
  await expect(
    service.execute({ action: 'next', generation }, 'task', signal),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(readNext).toHaveBeenCalledTimes(1);
  expect(provider.connect).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  // 2、用户断开、替换及 Worker 退出均释放连接；重复 close 无额外操作。
  await service.execute({ action: 'disconnect', generation }, 'task', signal);
  expect(disconnect).toHaveBeenCalledTimes(1);
  await service.execute(connect, 'task', signal);
  await service.execute(connect, 'task', signal);
  expect(disconnect).toHaveBeenCalledTimes(2);
  service.close();
  service.close();
  expect(disconnect).toHaveBeenCalledTimes(3);
});
