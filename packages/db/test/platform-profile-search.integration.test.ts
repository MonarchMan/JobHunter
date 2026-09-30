import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  PlatformBrowsingService,
  WebPlatformService,
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  WorkerEngine,
  RetryPolicy,
  ScheduleService,
} from '@jobhunter/application';
import { contentHash, parseId, SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { platformDefinitions, type PlatformJobDetail } from '@jobhunter/platform-core';
import { createTemporaryDataRoot, makeCandidateProfile } from '@jobhunter/testkit';
import {
  openSqliteDatabase,
  SqliteCandidateProfileRepository,
  SqliteJobQueryRepository,
  SqlitePlatformRepository,
  SqliteTaskRepository,
} from '../src/index.js';

/** 仅上游为替身；真实资料、队列、Worker、平台入库及统一查询走完整链路。 */
it.each(['boss', 'zhilian', '51job', 'liepin'] as const)(
  '%s 从默认资料逐词搜索并在正式库合并去重',
  async (provider) => {
    const root = await createTemporaryDataRoot('platform-profile-search-');
    const db = openSqliteDatabase({ dataRoot: root.path });
    const ids = new SystemIdGenerator();
    const profiles = new SqliteCandidateProfileRepository(db.client);
    const repository = new SqlitePlatformRepository(db.client, provider);
    const queue = new SqliteTaskRepository(db.client);
    const registry = new HandlerRegistry();
    const dependencies = { queue, ids, clock: { now: () => utcInstant(1000) } };
    /** 两词共享同一个稳定身份，详情调用与列表样本构造分开计数。 */
    const detail = (id: string): PlatformJobDetail => ({
      externalJobId: id,
      externalCompanyId: 'company',
      title: '软件工程师',
      company: '测试企业',
      city: '上海',
      salary: '',
      experience: '',
      education: '',
      sourceUrl: platformDefinitions[provider].baseUrl + '/fixture',
      description: '完整测试职位正文。',
    });
    const details = vi.fn((id: string) => Promise.resolve(detail(id)));
    const keywordCalls: string[] = [];
    const service = new PlatformBrowsingService(
      {
        connect: (input) => {
          const keyword = input.search?.keyword;
          if (!keyword) throw new Error('Missing keyword');
          keywordCalls.push(keyword);
          let page = 0;
          return Promise.resolve({
            disconnect: () => undefined,
            readDetail: details,
            readNext: () => {
              page++;
              const names =
                page === 1
                  ? ['shared', keyword === '算法工程师' ? 'first' : 'second']
                  : [keyword === '算法工程师' ? 'next-first' : 'next-second'];
              const candidates = names.map((id) => {
                const { description, ...candidate } = detail(id);
                void description;
                return candidate;
              });
              return Promise.resolve({ candidates, hasMore: page === 1 });
            },
          });
        },
      },
      repository,
      () => 1000,
      profiles,
    );
    registry.register(createPlatformTaskHandler(provider, service));
    const tasks = new TaskService(dependencies, registry);
    const web = new WebPlatformService(repository, tasks, provider, profiles);
    const worker = new WorkerEngine({
      queue,
      registry,
      clock: dependencies.clock,
      retryPolicy: new RetryPolicy({ next: () => 0.5 }),
      scheduleService: new ScheduleService(dependencies, registry),
      options: { workerId: 'profile-search-test' },
    });
    try {
      // 1、无资料时只投影修正提示；不会凭空加入实验关键词。
      expect(web.snapshot().profileSearch?.keywords).toEqual([]);
      expect(typeof web.snapshot().profileSearch?.error).toBe('string');
      for (const [index, roles] of [
        ['算法工程师', 'Agent开发工程师'],
        ['不应使用的第二份资料'],
      ].entries()) {
        const profileId = parseId(ids.generate(), 'CandidateProfile');
        const profile = makeCandidateProfile({ targetRoles: ['研发'], intendedRoles: roles });
        profiles.createProfile({
          id: profileId,
          name: '测试资料',
          createdAt: utcInstant(index + 1),
          updatedAt: utcInstant(index + 1),
        });
        profiles.appendVersion({
          expectedCurrentVersionId: null,
          version: {
            id: parseId(ids.generate(), 'ProfileVersion'),
            profileId,
            versionNo: 1,
            resumeDocumentId: null,
            agentRunId: null,
            extracted: profile,
            effective: profile,
            lockedPaths: [],
            contentHash: contentHash(profile),
            isCurrent: true,
            createdAt: utcInstant(index + 1),
          },
        });
      }
      expect(web.snapshot().profileSearch).toEqual({
        keywords: ['算法工程师', 'Agent开发工程师'],
        error: null,
      });
      // 2、Web 发布同一个有界动作，经 Worker 真实写入；跨词共享职位只保存一次。
      for (let round = 0; round < 2; round++) {
        details.mockClear();
        const task = web.mutate({
          command: { action: 'acquire', generation: repository.generation(), profileSearch: true },
          idempotencyToken: randomUUID(),
        });
        expect(await worker.runOnce('platform.' + provider)).toBe(true);
        const record = tasks
          .list({ taskType: 'platform.' + provider })
          .find((row) => row.id === task.taskId);
        expect(record?.status).toBe('succeeded');
        expect(record?.result).toMatchObject({
          savedCount: round === 0 ? 3 : 2,
          searchKeywords: ['算法工程师', 'Agent开发工程师'],
          hasMore: round === 0,
        });
        expect(details).toHaveBeenCalledTimes(round === 0 ? 3 : 2);
        expect(repository.verifyObservedBatch(task.taskId, round === 0 ? 3 : 2)).toBe(true);
      }
      expect(keywordCalls).toEqual(['算法工程师', 'Agent开发工程师']);
      expect(web.snapshot().batch?.searchBatches).toHaveLength(2);
      // 3、统一职位查询只显示本平台数据，官网同步和缺失计数完全不变。
      const query = new SqliteJobQueryRepository(db.client);
      expect(query.query({ sourceKind: 'platform', providerKey: provider }).items).toHaveLength(5);
      expect(query.query({ sourceKind: 'official' }).items).toHaveLength(0);
      expect(db.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
      expect(db.client.prepare('SELECT sum(missing_count) FROM jobs').pluck().get()).toBe(0);
      expect(db.client.pragma('foreign_key_check')).toEqual([]);
    } finally {
      await worker.shutdown();
      service.close();
      db.close();
      await root.cleanup();
    }
  },
);
