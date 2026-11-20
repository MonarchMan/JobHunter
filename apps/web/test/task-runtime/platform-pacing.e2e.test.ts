import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  BossCdpSessionProvider,
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
  LiepinCdpSessionProvider,
} from '@jobhunter/recruitment/platform-connectors';
import { HandlerRegistry, TaskService } from '@jobhunter/common/tasks';
import type { PlatformCandidate } from '@jobhunter/recruitment/platform-contracts';
import { createPlatformTaskHandler } from '@jobhunter/recruitment/platform-application/platforms';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import { createProductionTaskApplication } from '../../src/server/task-runtime.js';

/** 真实生产装配和隔离队列验证四平台覆盖值；浏览器及上游不参与。 */
const pacingCases: readonly [
  number,
  Readonly<Partial<Record<'boss' | 'zhilian' | '51job' | 'liepin', number>>>,
][] = [
  [0, { boss: 0, zhilian: 0, '51job': 0, liepin: 1000 }],
  [50, { boss: 100, liepin: 0 }],
];

it('启动新的执行线程时保留宿主中所有平台的连接代次和状态', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-generation-'));
  const host = createProductionTaskApplication({ dataRoot: root, periodicEnabled: false });
  const db = openSqliteDatabase({ dataRoot: root, runMigrations: false });
  try {
    const select = db.client.prepare(
      'SELECT provider_key, generation, status FROM platform_connections ORDER BY provider_key',
    );
    expect(select.all()).toHaveLength(4);
    db.client
      .prepare("UPDATE platform_connections SET generation = generation + 1, status = 'available'")
      .run();
    const active = select.all();
    const thread = createProductionTaskApplication({ dataRoot: root, executionOnly: true });
    try {
      expect(select.all()).toEqual(active);
    } finally {
      await thread.close();
    }
    expect(select.all()).toEqual(active);
  } finally {
    await host.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(pacingCases)('生产统一间隔 %s 与平台覆盖分别传递', async (interval, overrides) => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-pacing-'));
  const providers = [
    ['boss', BossCdpSessionProvider],
    ['zhilian', ZhilianCdpSessionProvider],
    ['51job', Job51CdpSessionProvider],
    ['liepin', LiepinCdpSessionProvider],
  ] as const;
  const received: unknown[] = [];
  const connectionManagers: unknown[] = [];
  for (const [provider, Provider] of providers)
    vi.spyOn(Provider.prototype, 'connect').mockImplementation(function (this: object) {
      received.push(Reflect.get(this, 'requestIntervalMs'));
      connectionManagers.push(Reflect.get(this, 'connections'));
      let page = 0;
      const candidate = (id: string): PlatformCandidate => ({
        externalJobId: id,
        externalCompanyId: 'company',
        title: '测试岗位',
        company: '测试公司',
        city: '',
        salary: '',
        experience: '',
        education: '',
        sourceUrl: `https://example.test/jobs/${id}`,
      });
      return Promise.resolve({
        readNext: () =>
          Promise.resolve({
            candidates: [candidate(`${provider}-${String(++page)}`)],
            hasMore: true,
          }),
        readDetail: (id) => Promise.resolve({ ...candidate(id), description: '完整岗位正文' }),
        disconnect: () => undefined,
      });
    });
  const worker = createProductionTaskApplication({
    dataRoot: root,
    platformRequestIntervalMs: interval,
    platformBatchesPerRun: 2,
    platformRequestIntervalMsByProvider: overrides,
  });
  const db = openSqliteDatabase({ dataRoot: root });
  const queue = new SqliteTaskRepository(db.client),
    registry = new HandlerRegistry();
  for (const [provider] of providers)
    registry.register(
      createPlatformTaskHandler(provider, {
        execute: () => Promise.reject(new Error('Publisher only')),
      }),
    );
  const tasks = new TaskService(
    { queue, ids: new SystemIdGenerator(), clock: { now: () => utcInstant(Date.now()) } },
    registry,
  );
  try {
    // 1、同一生产装配逐平台发布初始化；各自的 Provider 必须收到同一配置。
    for (const [provider] of providers) {
      const submitted = tasks.enqueue({
        taskType: `platform.${provider}`,
        payload: {
          action: 'connect',
          ...(provider === 'zhilian' ? { search: { keyword: '研发', city: '' } } : {}),
        },
        idempotencyKey: `${provider}:${String(interval)}`,
      });
      await worker.engine.runOnce(`platform.${provider}`);
      expect(queue.get(submitted.task.id)?.status).toBe('succeeded');
      const generation = db.client
        .prepare('SELECT generation FROM platform_connections WHERE provider_key=?')
        .pluck()
        .get(provider);
      const run = tasks.enqueue({
        taskType: `platform.${provider}`,
        payload: { action: 'acquire', generation },
        idempotencyKey: `${provider}:acquire:${String(interval)}`,
      });
      await worker.engine.runOnce(`platform.${provider}`);
      expect(queue.get(run.task.id)?.result).toMatchObject({
        savedCount: 2,
        hasMore: true,
        progress: { batchNumber: 2, batchLimit: 2 },
      });
      expect(
        db.client
          .prepare('SELECT count(*) FROM job_observations WHERE platform_task_id=?')
          .pluck()
          .get(run.task.id),
      ).toBe(2);
    }
    expect(received).toEqual([
      overrides.boss ?? interval,
      overrides.zhilian ?? interval,
      overrides['51job'] ?? interval,
      overrides.liepin ?? interval,
    ]);
    // 2、四平台必须由生产装配注入同一个管理器，而不是只在诊断中共享 Socket。
    expect(connectionManagers[0]).toBeDefined();
    expect(new Set(connectionManagers).size).toBe(1);
  } finally {
    // 2、只清理本测试独占临时目录，不接触日常库或真实连接。
    await worker.close();
    db.close();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
