import { expect, it, vi, type Mock } from 'vitest';
import {
  PlatformError,
  type PlatformJobDetail,
  type PlatformSession,
} from '@jobhunter/platform-core';
import {
  bossCommandSchema,
  BossPlatformService,
  type BossResult,
  type PlatformRepository,
} from '../src/platforms.js';

/** 批次测试的可观察端口，用于验证请求和提交顺序。 */
interface BatchFixture {
  repository: PlatformRepository;
  session: {
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
}

/** 有界批次替身，不接触浏览器或真实平台。 */
function batchFixture(): BatchFixture {
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
  const repository: PlatformRepository = {
    reset: () => ++generation,
    generation: () => generation,
    setStatus: vi.fn(),
    save,
  };
  const session = {
    readNext: vi.fn<PlatformSession['readNext']>(() =>
      Promise.resolve({ candidates: ['1', '2', '3'].map(detail), hasMore: true }),
    ),
    readDetail: vi.fn<PlatformSession['readDetail']>((id: string) => {
      events.push(`detail:${id}`);
      return Promise.resolve(detail(id));
    }),
    disconnect: vi.fn(),
  };
  const service = new BossPlatformService({ connect: () => Promise.resolve(session) }, repository);
  const controller = new AbortController();
  const connect = (): Promise<BossResult> =>
    service.execute(
      { action: 'connect', portFile: '/fixture/DevToolsActivePort', targetId: 'test' },
      'task',
      controller.signal,
    );
  const next = (): Promise<BossResult> =>
    service.execute({ action: 'next', generation }, 'task', controller.signal);
  return { repository, session, save, controller, events, detail, connect, next };
}

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
});

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
