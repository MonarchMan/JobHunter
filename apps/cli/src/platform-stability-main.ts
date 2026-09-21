#!/usr/bin/env node
import path from 'node:path';
import { Command, Option } from 'commander';
import {
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  observePlatformRound,
} from '@jobhunter/application';
import { openSqliteDatabase, SqliteTaskRepository, SqlitePlatformRepository } from '@jobhunter/db';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
/** 与应用观察端口共享平台键，不在入口复制平台身份定义。 */
type PlatformProviderKey = Parameters<typeof observePlatformRound>[0]['provider'];

/** 单轮观察只提交所选平台任务，各平台分别调度、分别停止，不建立 CDP。 */
async function main(): Promise<void> {
  const program = new Command()
    .addOption(
      new Option('--provider <provider>')
        .choices(['boss', 'zhilian', '51job', 'liepin'])
        .default('boss'),
    )
    .requiredOption('--data-root <path>')
    .requiredOption('--generation <number>')
    .requiredOption('--round <number>')
    .requiredOption('--not-before <iso>')
    .requiredOption('--deadline <iso>');
  program.parse();
  const options = program.opts<{
    provider: PlatformProviderKey;
    dataRoot: string;
    generation: string;
    round: string;
    notBefore: string;
    deadline: string;
  }>();
  const generation = Number(options.generation),
    round = Number(options.round);
  const notBefore = Date.parse(options.notBefore),
    deadline = Date.parse(options.deadline);
  // 1、兼容 BOSS 默认值；每个平台独立执行 0～4 轮，不等待数小时或创建调度。
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
  if (Date.now() < notBefore || Date.now() >= deadline)
    throw new Error('Outside observation window.');
  const database = openSqliteDatabase({ dataRoot: options.dataRoot, runMigrations: false });
  try {
    const repository = new SqlitePlatformRepository(database.client, options.provider);
    const registry = new HandlerRegistry();
    registry.register(
      createPlatformTaskHandler(options.provider, {
        execute: () => Promise.reject(new Error('Worker required.')),
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
    // 2、只检验本轮已提交事实，不补发详情，不将其他平台／官网记录作为本轮失败。
    const result = await observePlatformRound({
      provider: options.provider,
      generation,
      round,
      deadline,
      tasks,
      connection: () => repository.snapshot(),
      verifySaved: (batch, task) => {
        if (
          batch.savedCount === undefined ||
          !repository.verifyObservedBatch(task.id, batch.savedCount)
        )
          throw new Error('Persistence invariant failed.');
      },
    });
    console.log(JSON.stringify({ ...result, generation, observedAt: new Date().toISOString() }));
  } finally {
    database.close();
  }
}

// 3、错误来自固定本地检查；不回显上游异常、请求或认证上下文。
await main().catch((error: unknown) => {
  const allowed = [
    'Invalid observation bounds.',
    'Outside observation window.',
    'Previous observation did not complete; observation stopped.',
  ];
  console.error(
    error instanceof Error && allowed.includes(error.message)
      ? error.message
      : 'Platform observation stopped; check window, prior round and platform task diagnostics.',
  );
  process.exitCode = 1;
});
