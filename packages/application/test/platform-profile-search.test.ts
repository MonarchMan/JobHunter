import { expect, it, vi } from 'vitest';
import {
  PlatformError,
  type PlatformCandidate,
  type PlatformSessionProvider,
} from '@jobhunter/platform-core';
import type { CandidateProfileRecord, ProfileVersionRecord } from '../src/ports/profiles.js';
import {
  connectPlatformProfileSearch,
  platformProfileSearchPlan,
} from '../src/platform-profile-search.js';
import { PlatformBrowsingService, type PlatformRepository } from '../src/platforms.js';

/** 测试身份只覆盖默认资料选择与实际搜索词，不构造真实简历内容。 */
function profileFixture(roles?: string[]): Parameters<typeof platformProfileSearchPlan>[0] {
  return {
    listProfiles: () =>
      [
        { id: 'first', createdAt: 1 },
        { id: 'second', createdAt: 2 },
      ] as CandidateProfileRecord[],
    getCurrentVersion: (id) =>
      ({
        id: `${id}-version`,
        effective: {
          targetRoles: ['研发'],
          matchingConstraints: { targetSubfamily: '后端开发' },
          intendedRoles: id === 'first' ? roles : ['不应使用的岗位'],
        },
      }) as ProfileVersionRecord,
  };
}

/** 两个关键词有同一职位，必须只保留一次详情。 */
function candidate(id: string): PlatformCandidate {
  return {
    externalJobId: id,
    externalCompanyId: 'company',
    title: '工程师',
    company: '企业',
    city: '北京',
    salary: '',
    experience: '',
    education: '',
    sourceUrl: `https://example.com/${id}`,
  };
}

it('只使用默认第一份资料的具体意向词并去重', () => {
  expect(
    platformProfileSearchPlan(
      profileFixture([' 大模型算法工程师 ', '大模型算法工程师', 'Agent 开发工程师']),
    ),
  ).toEqual({
    profileVersionId: 'first-version',
    keywords: ['大模型算法工程师', 'Agent 开发工程师'],
  });
  expect(() => platformProfileSearchPlan(profileFixture([]))).toThrow(PlatformError);
  // 旧资料即使有类别及细分岗位，也不能据此补齐缺失的具体意向。
  expect(() => platformProfileSearchPlan(profileFixture())).toThrow(
    expect.objectContaining({ reason: 'query_required' }),
  );
  let broadError: unknown;
  try {
    platformProfileSearchPlan(profileFixture(['研发']));
  } catch (error) {
    broadError = error;
  }
  expect(broadError).toMatchObject({ category: 'session_unavailable', reason: 'query_too_broad' });
  expect(() =>
    platformProfileSearchPlan(
      profileFixture(Array.from({ length: 11 }, (_, i) => `岗位${String(i)}`)),
    ),
  ).toThrow(PlatformError);
});

it('每词独立读取一批，跨词重复职位只请求一次详情', async () => {
  const detail = vi.fn((id: string) =>
    Promise.resolve({ ...candidate(id), description: '完整正文' }),
  );
  const first = {
    readNext: vi
      .fn()
      .mockResolvedValueOnce({ candidates: [candidate('a'), candidate('b')], hasMore: true })
      .mockResolvedValueOnce({ candidates: [candidate('c')], hasMore: false }),
    readDetail: detail,
    disconnect: vi.fn(),
  };
  const second = {
    readNext: vi
      .fn()
      .mockResolvedValueOnce({ candidates: [candidate('b'), candidate('d')], hasMore: false }),
    readDetail: detail,
    discardDetail: vi.fn(),
    disconnect: vi.fn(),
  };
  const connect = vi
    .fn<PlatformSessionProvider['connect']>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const provider: PlatformSessionProvider = { connect };
  const signal = new AbortController().signal;
  const session = await connectPlatformProfileSearch(
    provider,
    {
      profileVersionId: 'version',
      keywords: ['算法工程师', 'Agent 工程师'],
    },
    {},
    signal,
  );
  expect(connect.mock.calls.map(([input]) => input.search?.keyword)).toEqual([
    '算法工程师',
    'Agent 工程师',
  ]);
  const batch = await session.readNext(signal);
  expect(batch.candidates.map((row) => row.externalJobId)).toEqual(['a', 'b', 'd']);
  expect(batch.searchBatches).toEqual([
    { keyword: '算法工程师', count: 2, hasMore: true },
    { keyword: 'Agent 工程师', count: 2, hasMore: false },
  ]);
  await session.readDetail('b', signal);
  expect(detail).toHaveBeenCalledTimes(1);
  expect(second.discardDetail).toHaveBeenCalledExactlyOnceWith('b');
  const next = await session.readNext(signal);
  expect(next.candidates.map((row) => row.externalJobId)).toEqual(['c']);
  expect(second.readNext).toHaveBeenCalledTimes(1);
  session.disconnect();
  expect(first.disconnect).toHaveBeenCalledOnce();
  expect(second.disconnect).toHaveBeenCalledOnce();
});

it('任一词连接失败时释放此前已经建立的搜索会话', async () => {
  const prior = { readNext: vi.fn(), readDetail: vi.fn(), disconnect: vi.fn() };
  const provider: PlatformSessionProvider = {
    connect: vi
      .fn()
      .mockResolvedValueOnce(prior)
      .mockRejectedValueOnce(new PlatformError('session_unavailable')),
  };
  await expect(
    connectPlatformProfileSearch(
      provider,
      {
        profileVersionId: 'version',
        keywords: ['算法', '后端'],
      },
      {},
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(PlatformError);
  expect(prior.disconnect).toHaveBeenCalledOnce();
});

it('单个关键词本批内部重复职位仍报告协议变化', async () => {
  const session = await connectPlatformProfileSearch(
    {
      connect: vi.fn().mockResolvedValue({
        readNext: vi.fn().mockResolvedValue({
          candidates: [candidate('same'), candidate('same')],
          hasMore: false,
        }),
        readDetail: vi.fn(),
        disconnect: vi.fn(),
      }),
    },
    { profileVersionId: 'version', keywords: ['算法工程师'] },
    {},
    new AbortController().signal,
  );
  await expect(session.readNext(new AbortController().signal)).rejects.toMatchObject({
    category: 'parse_changed',
  });
});

it('无默认资料时在建立浏览器连接前拒绝搜索', async () => {
  let generation = 1;
  const connect = vi.fn<PlatformSessionProvider['connect']>();
  const service = new PlatformBrowsingService(
    { connect },
    {
      reset: () => ++generation,
      generation: () => generation,
      setStatus: vi.fn(),
      recordProgress: vi.fn(),
      save: vi.fn(),
    },
    Date.now,
    { listProfiles: () => [], getCurrentVersion: () => null },
  );
  await expect(
    service.execute(
      { action: 'acquire', generation, profileSearch: true },
      'task',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ reason: 'profile_required' });
  expect(connect).not.toHaveBeenCalled();
});

it('资料搜索按词合并后入库，资料版本变化不沿用旧游标', async () => {
  let generation = 1;
  let versionId = 'first-version';
  const save = vi.fn<PlatformRepository['save']>((detail) => detail.externalJobId);
  const repository: PlatformRepository = {
    reset: () => ++generation,
    generation: () => generation,
    setStatus: vi.fn(),
    recordProgress: vi.fn(),
    save,
  };
  const readDetail = vi.fn((id: string) =>
    Promise.resolve({ ...candidate(id), description: '完整正文' }),
  );
  const connect = vi.fn<PlatformSessionProvider['connect']>((input) =>
    Promise.resolve({
      readNext: vi.fn().mockResolvedValue({
        candidates:
          input.search?.keyword === '算法工程师'
            ? [candidate('a'), candidate('shared')]
            : [candidate('shared'), candidate('b')],
        hasMore: true,
      }),
      readDetail,
      disconnect: vi.fn(),
    }),
  );
  const profiles = {
    listProfiles: () => [{ id: 'first' }] as CandidateProfileRecord[],
    getCurrentVersion: () =>
      ({
        id: versionId,
        effective: { targetRoles: ['研发'], intendedRoles: ['算法工程师', 'Agent 工程师'] },
      }) as ProfileVersionRecord,
  };
  const service = new PlatformBrowsingService({ connect }, repository, Date.now, profiles);
  const signal = new AbortController().signal;
  const result = await service.execute(
    { action: 'acquire', generation, profileSearch: true },
    'task-one',
    signal,
  );
  expect(result).toMatchObject({
    status: 'available',
    savedCount: 3,
    searchKeywords: ['算法工程师', 'Agent 工程师'],
  });
  expect(result.searchBatches).toHaveLength(2);
  expect(connect.mock.calls.map(([input]) => input.search?.keyword)).toEqual([
    '算法工程师',
    'Agent 工程师',
  ]);
  expect(readDetail).toHaveBeenCalledTimes(3);
  expect(save).toHaveBeenCalledTimes(3);
  versionId = 'updated-version';
  await expect(
    service.execute({ action: 'next', generation }, 'task-two', signal),
  ).rejects.toMatchObject({
    reason: 'query_changed',
  });
  expect(connect).toHaveBeenCalledTimes(2);
});

it('日常资料搜索不复用旧推荐连接，失败进度明确要求重连', async () => {
  let generation = 0;
  const readNext = vi.fn();
  const report = vi.fn();
  const service = new PlatformBrowsingService(
    {
      connect: () =>
        Promise.resolve({
          readNext,
          readDetail: vi.fn(),
          disconnect: vi.fn(),
        }),
    },
    {
      reset: () => ++generation,
      generation: () => generation,
      setStatus: vi.fn(),
      recordProgress: report,
      save: vi.fn(),
    },
    Date.now,
    profileFixture(['算法工程师']),
  );
  const signal = new AbortController().signal;
  await service.execute({ action: 'connect' }, 'legacy-connect', signal);
  await expect(
    service.execute({ action: 'acquire', generation, profileSearch: true }, 'acquire', signal),
  ).rejects.toMatchObject({ reason: 'query_changed' });
  expect(readNext).not.toHaveBeenCalled();
  expect(report.mock.calls.at(-1)?.[2]).toMatchObject({
    failure: { category: 'session_unavailable', reason: 'query_changed' },
  });
  service.close();
});
