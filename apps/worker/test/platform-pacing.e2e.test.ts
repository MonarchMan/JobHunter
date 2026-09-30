import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  BossCdpSessionProvider,
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
  LiepinCdpSessionProvider,
} from '@jobhunter/platform-connectors';
import { HandlerRegistry, TaskService, createPlatformTaskHandler } from '@jobhunter/application';
import { openSqliteDatabase, SqliteTaskRepository } from '@jobhunter/db';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { createProductionWorkerApplication } from '../src/index.js';

/** 真实生产装配和隔离队列验证四平台覆盖值；浏览器及上游不参与。 */
const pacingCases: readonly [
  number,
  Readonly<Partial<Record<'boss' | 'zhilian' | '51job' | 'liepin', number>>>,
][] = [
  [0, { boss: 0, zhilian: 0, '51job': 0, liepin: 1000 }],
  [50, { boss: 100, liepin: 0 }],
];
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
  for (const [, Provider] of providers)
    vi.spyOn(Provider.prototype, 'connect').mockImplementation(function (this: object) {
      received.push(Reflect.get(this, 'requestIntervalMs'));
      connectionManagers.push(Reflect.get(this, 'connections'));
      return Promise.resolve({
        readNext: () => Promise.resolve({ candidates: [], hasMore: false }),
        readDetail: () => Promise.reject(new Error('Unexpected detail')),
        disconnect: () => undefined,
      });
    });
  const worker = createProductionWorkerApplication({
    dataRoot: root,
    platformRequestIntervalMs: interval,
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
