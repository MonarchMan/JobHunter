import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import {
  bossResultSchema,
  createBossPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  WebBossService,
  type BossCommand,
  type BossResult,
} from '@jobhunter/application';
import {
  openSqliteDatabase,
  SqliteJobQueryRepository,
  SqlitePlatformRepository,
  SqliteTaskRepository,
} from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/domain';
import { createProductionWorkerApplication } from '../src/index.js';

/** 批次现在自动补齐本页全部详情，必须额外显式选择新语义，避免复用旧环境意外扩大请求量。 */
it.skipIf(
  !process.env.BOSS_CDP_PORT_FILE ||
    !process.env.BOSS_CDP_TARGET_ID ||
    process.env.BOSS_SMOKE_AUTO_BATCH !== '1',
)(
  'BOSS production wiring saves bounded HTTP details with one browser session',
  async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'boss-production-smoke-'));
    const database = openSqliteDatabase({ dataRoot });
    const worker = createProductionWorkerApplication({ dataRoot });
    const registry = new HandlerRegistry();
    registry.register(
      createBossPlatformTaskHandler({
        execute: () => Promise.reject(new Error('Publisher only.')),
      }),
    );
    const tasks = new TaskService(
      {
        queue: new SqliteTaskRepository(database.client),
        clock: { now: () => utcInstant(Date.now()) },
        ids: new SystemIdGenerator(),
      },
      registry,
    );
    const web = new WebBossService(new SqlitePlatformRepository(database.client), tasks);
    const pageCount = process.env.BOSS_SMOKE_PAGES === '2' ? 2 : 1;
    let lastRequestAt: number | null = null;
    /** 用与 Web 一致的发布入口驱动真实生产 Worker，仅记录数量和状态。 */
    const run = async (command: BossCommand): Promise<BossResult> => {
      // 1、恢复后降低请求密度；间隔不保证免于风控，不作失败重试。
      if (command.action === 'next' || command.action === 'detail') {
        if (lastRequestAt !== null) await delay(Math.max(0, 30_000 - (Date.now() - lastRequestAt)));
        lastRequestAt = Date.now();
      }
      const task = web.mutate({ command, idempotencyToken: randomUUID() });
      expect(await worker.engine.runOnce('platform.boss')).toBe(true);
      const completed = tasks.get(parseId(task.taskId, 'Task'));
      if (completed?.status !== 'succeeded')
        throw new Error(`${command.action}: ${completed?.errorSummary ?? 'task failed'}`);
      return bossResultSchema.parse(completed.result);
    };
    try {
      const connected = await run({
        action: 'connect',
        portFile: String(process.env.BOSS_CDP_PORT_FILE),
        targetId: String(process.env.BOSS_CDP_TARGET_ID),
      });
      const generation = connected.generation;
      const counts: { kept: number; skipped: number }[] = [];
      for (let page = 0; page < pageCount; page++) {
        const batch = await run({ action: 'next', generation });
        counts.push({
          kept: batch.candidates?.length ?? 0,
          skipped: batch.skippedMissingCompanyId ?? 0,
        });
        if (!batch.candidates?.length) throw new Error('Smoke needs a non-anonymous candidate.');
        expect(batch.savedCount).toBe(batch.candidates.length);
        const saved = new SqliteJobQueryRepository(database.client).query({
          sourceKind: 'platform',
          providerKey: 'boss',
        });
        for (const job of saved.items)
          expect(
            new SqliteJobQueryRepository(database.client).get(job.id)?.description,
          ).toBeTruthy();
        if (!batch.hasMore) break;
      }
      expect(database.client.prepare('SELECT count(*) FROM sync_runs').pluck().get()).toBe(0);
      expect(
        database.client.prepare('SELECT count(*) FROM jobs WHERE missing_count <> 0').pluck().get(),
      ).toBe(0);
      expect(database.client.pragma('foreign_key_check')).toEqual([]);
      const savedCount = database.client.prepare('SELECT count(*) FROM jobs').pluck().get();
      expect(savedCount).toBe(counts.reduce((sum, batch) => sum + batch.kept, 0));
      console.log(
        JSON.stringify({
          smoke: 'boss-production',
          pages: counts,
          saved: savedCount,
        }),
      );
      await run({ action: 'disconnect', generation });
      expect(web.snapshot().connection?.status).toBe('disconnected');
    } finally {
      await worker.close();
      database.close();
      await rm(dataRoot, { recursive: true, force: true });
    }
  },
  600_000,
);
