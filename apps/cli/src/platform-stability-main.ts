#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { Command } from 'commander';
import {
  bossResultSchema,
  createBossPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  type BossCommand,
  type BossResult,
} from '@jobhunter/application';
import {
  openSqliteDatabase,
  SqliteTaskRepository,
  SqlitePlatformRepository,
  SqliteJobQueryRepository,
} from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/domain';

/** 单轮观察只发布幂等任务；持续 Worker 持有连接，本进程不创建 CDP 或定时器计划。 */
async function main(): Promise<void> {
  const program = new Command()
    .requiredOption('--data-root <path>')
    .requiredOption('--generation <number>')
    .requiredOption('--round <number>')
    .requiredOption('--not-before <iso>')
    .requiredOption('--deadline <iso>');
  program.parse();
  const options = program.opts<{
    dataRoot: string;
    generation: string;
    round: string;
    notBefore: string;
    deadline: string;
  }>();
  const generation = Number(options.generation);
  const round = Number(options.round);
  const notBefore = Date.parse(options.notBefore);
  const deadline = Date.parse(options.deadline);
  // 1、仅允许有界轮次和时间窗口；不承担等待数小时或自行重启 Worker 的职责。
  if (
    !path.isAbsolute(options.dataRoot) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isInteger(round) ||
    round < 0 ||
    round > 4 ||
    !Number.isFinite(notBefore) ||
    !Number.isFinite(deadline) ||
    deadline <= notBefore
  )
    throw new Error('Invalid observation bounds.');
  if (Date.now() < notBefore || Date.now() > deadline)
    throw new Error('Outside observation window.');
  const database = openSqliteDatabase({ dataRoot: options.dataRoot, runMigrations: false });
  const repository = new SqlitePlatformRepository(database.client);
  const registry = new HandlerRegistry();
  registry.register(
    createBossPlatformTaskHandler({ execute: () => Promise.reject(new Error('Worker required.')) }),
  );
  const tasks = new TaskService(
    {
      queue: new SqliteTaskRepository(database.client),
      clock: { now: () => utcInstant(Date.now()) },
      ids: new SystemIdGenerator(),
    },
    registry,
  );
  /** 严格守住原代次；任何失败都交还操作者，不重连或覆盖失败证据。 */
  const assertSession = (): void => {
    const connection = repository.snapshot();
    if (
      connection?.generation !== generation ||
      !['connected', 'available'].includes(connection.status)
    )
      throw new Error('Original session is unavailable; observation stopped.');
  };
  /** 相同轮次复用原任务，任务结果不明时不得另发下一批。 */
  const run = async (
    command: BossCommand,
    action: string,
  ): Promise<{ result: BossResult; finishedAt: number }> => {
    assertSession();
    if (Date.now() > deadline) throw new Error('Observation deadline passed.');
    const submitted = tasks.enqueue({
      taskType: 'platform.boss',
      payload: command,
      idempotencyKey: `boss:stability:${String(generation)}:${String(round)}:${action}`,
    });
    if (submitted.kind === 'concurrency_conflict')
      throw new Error('Another platform action is active.');
    const waitUntil = Math.min(deadline, Date.now() + 90_000);
    while (Date.now() < waitUntil) {
      const task = tasks.get(submitted.task.id);
      if (task?.status === 'succeeded')
        return {
          result: bossResultSchema.parse(task.result),
          finishedAt: task.finishedAt ?? Date.now(),
        };
      if (!task || task.status === 'failed' || task.status === 'cancelled')
        throw new Error(
          `Observation ${action} stopped: ${task?.errorSummary ?? 'task unavailable'}`,
        );
      await delay(1000);
    }
    tasks.cancel(submitted.task.id);
    throw new Error('Worker did not finish in time; cancellation requested.');
  };
  try {
    // 2.a、前轮未完整成功不能继续，防止本地失败后下一次调度掩盖缺失证据。
    if (round > 0) {
      const previous = tasks
        .list({ taskType: 'platform.boss', limit: 100 })
        .find(
          (task) =>
            task.idempotencyKey ===
            `boss:stability:${String(generation)}:${String(round - 1)}:detail`,
        );
      if (previous?.status !== 'succeeded' || !bossResultSchema.safeParse(previous.result).success)
        throw new Error('Previous observation did not complete; observation stopped.');
    }
    // 2、每轮只读取一批；空候选或末页不追加页面来凑成功样本。
    const batch = await run({ action: 'next', generation }, 'next');
    const first = batch.result.candidates?.[0];
    if (!first) throw new Error('No eligible candidate; observation cannot verify details.');
    await delay(Math.max(0, 30_000 - (Date.now() - batch.finishedAt)));
    const detail = await run(
      { action: 'detail', generation, externalJobId: first.externalJobId },
      'detail',
    );
    const jobId = detail.result.jobId;
    if (!jobId || !new SqliteJobQueryRepository(database.client).get(parseId(jobId, 'Job')))
      throw new Error('Saved job is not queryable.');
    // 3、隔离库验证正式生命周期副作用；输出只包含安全计数与稳定身份。
    if (
      (database.client.pragma('foreign_key_check') as unknown[]).length !== 0 ||
      database.client.prepare('SELECT count(*) FROM sync_runs').pluck().get() !== 0 ||
      database.client
        .prepare('SELECT count(*) FROM jobs WHERE missing_count <> 0')
        .pluck()
        .get() !== 0
    )
      throw new Error('Persistence invariant failed.');
    console.log(
      JSON.stringify({
        status: 'passed',
        round,
        generation,
        observedAt: new Date().toISOString(),
        kept: batch.result.candidates?.length ?? 0,
        skipped: batch.result.skippedMissingCompanyId ?? 0,
        hasMore: batch.result.hasMore,
        jobId,
      }),
    );
  } finally {
    database.close();
  }
}

// 4、仅暴露受控错误；平台任务本身已使用脱敏错误文本。
await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Observation failed.');
  process.exitCode = 1;
});
