#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Command, Option } from 'commander';
import {
  bossCommandSchema,
  createPlatformTaskHandler,
  HandlerRegistry,
  TaskService,
  platformRetentionCommandSchema,
  createPlatformRetentionTaskHandler,
} from '@jobhunter/application';
import { openSqliteDatabase, SqliteTaskRepository } from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, parseId } from '@jobhunter/domain';
import { loadRuntimeConfig } from './runtime-config.js';

/** CLI 仅提交动作或读取脱敏结果；凭据读取与网络执行始终由 Worker 完成。 */
async function run(): Promise<void> {
  const program = new Command()
    .name('platform')
    .option('--data-root <path>')
    .addOption(
      new Option(
        '--provider <provider>',
        '招聘平台（智联：校园／主站；51job：官网辅助；猎聘：学生推荐，连接时切换一次排序）',
      )
        .choices(['boss', 'zhilian', '51job', 'liepin'])
        .default('boss'),
    );
  /** Commander 白名单校验后的平台键；默认兼容旧 BOSS 命令。 */
  const provider = (): 'boss' | 'zhilian' | '51job' | 'liepin' =>
    program.opts<{ provider: 'boss' | 'zhilian' | '51job' | 'liepin' }>().provider;
  const submit = async (payload: unknown, taskType = `platform.${provider()}`): Promise<void> => {
    // 1、先校验输入，再使用统一配置打开数据库。
    const parsed =
      taskType === 'platform.retention'
        ? platformRetentionCommandSchema.parse(payload)
        : bossCommandSchema.parse(payload);
    const config = await loadRuntimeConfig({
      argv: process.argv.slice(2),
      workspaceRoot: path.resolve(import.meta.dirname, '../../..'),
    });
    const database = openSqliteDatabase({ dataRoot: config.bootstrap.dataRoot.value });
    try {
      // 2、复用相同任务定义；CLI 不允许执行处理器。
      const registry = new HandlerRegistry();
      registry.register(
        createPlatformRetentionTaskHandler({
          execute: () => {
            throw new Error('Worker required.');
          },
        }),
      );
      registry.register(
        createPlatformTaskHandler(provider(), {
          execute() {
            return Promise.reject(new Error('Worker required'));
          },
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
      console.log(
        JSON.stringify(
          tasks.enqueue({
            taskType,
            payload: parsed,
            idempotencyKey: `${provider()}:${randomUUID()}`,
          }),
        ),
      );
    } finally {
      database.close();
    }
  };
  program
    .command('connect')
    .description(
      '连接所选浏览器页；智联授权后在校园切换分类，或在主站搜索并打开一条详情；查询在连接时固定',
    )
    .requiredOption('--port-file <path>')
    .requiredOption('--target-id <id>')
    .addOption(
      new Option(
        '--acquisition-mode <mode>',
        '仅 BOSS：browser 观察官网新列表并点击该批职位详情；不刷新',
      ).choices(['http', 'browser']),
    )
    .action(
      async (options: {
        portFile: string;
        targetId: string;
        acquisitionMode?: 'http' | 'browser';
      }) => {
        // 1、浏览器辅助必须显式选择，不改变其他平台原有连接方式。
        if (options.acquisitionMode && provider() !== 'boss')
          throw new Error('acquisition-mode is only available for BOSS');
        await submit({ action: 'connect', ...options });
      },
    );
  program
    .command('retention-preview')
    .option('--days <number>', '保留天数', '30')
    .option('--interval-hours <number>', '清理间隔小时', '6')
    .action(async (options: { days: string; intervalHours: string }) => {
      await submit(
        {
          action: 'preview',
          policy: {
            retentionDays: Number(options.days),
            intervalHours: Number(options.intervalHours),
          },
        },
        'platform.retention',
      );
    });
  program
    .command('retention-enable')
    .requiredOption('--confirmation-token <token>', '预览返回的确认令牌；启用不可撤销的自动删除')
    .action(async (options: { confirmationToken: string }) => {
      await submit(
        { action: 'enable', confirmationToken: options.confirmationToken },
        'platform.retention',
      );
    });
  for (const action of ['disable', 'status'] as const)
    program.command(`retention-${action}`).action(async () => {
      await submit({ action }, 'platform.retention');
    });
  program
    .command('touch <jobId>')
    .description('明确标记用户交互，延长平台职位保留时间')
    .action(async (jobId: string) => {
      await submit({ action: 'touch', jobId }, 'platform.retention');
    });
  for (const action of ['next', 'disconnect'] as const)
    program
      .command(action)
      .requiredOption('--generation <number>')
      .action(async (options: { generation: string }) => {
        await submit({ action, generation: Number(options.generation) });
      });
  program
    .command('detail <externalJobId>')
    .requiredOption('--generation <number>')
    .action(async (externalJobId: string, options: { generation: string }) => {
      await submit({ action: 'detail', externalJobId, generation: Number(options.generation) });
    });
  program
    .command('resume')
    .description('仅 BOSS HTTP：确认官网正常后，恢复原进程内未完成批次，不重抓已保存详情')
    .requiredOption('--generation <number>')
    .requiredOption('--source-task-id <id>')
    .requiredOption('--browser-recovered', '明确确认官网已经恢复正常')
    .action(
      async (options: { generation: string; sourceTaskId: string; browserRecovered: boolean }) => {
        if (provider() !== 'boss') throw new Error('resume is only available for BOSS');
        await submit({
          action: 'resume',
          generation: Number(options.generation),
          sourceTaskId: options.sourceTaskId,
          browserRecovered: options.browserRecovered,
        });
      },
    );
  program.command('result <taskId>').action(async (taskId: string) => {
    const config = await loadRuntimeConfig({
      argv: process.argv.slice(2),
      workspaceRoot: path.resolve(import.meta.dirname, '../../..'),
    });
    const database = openSqliteDatabase({
      dataRoot: config.bootstrap.dataRoot.value,
      runMigrations: false,
    });
    try {
      const task = new SqliteTaskRepository(database.client).get(parseId(taskId, 'Task'));
      if (!task || ![`platform.${provider()}`, 'platform.retention'].includes(task.taskType))
        throw new Error('Platform task not found');
      console.log(JSON.stringify(task));
    } finally {
      database.close();
    }
  });
  await program.parseAsync();
}
// 3、错误不输出可能含凭据的底层异常或输入值。
await run().catch(() => {
  console.error('Platform command failed; check arguments, Worker and database.');
  process.exitCode = 1;
});
