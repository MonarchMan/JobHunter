import type { TaskRecord, TaskStatus } from '@jobhunter/application';
import { Command, CommanderError, Option } from 'commander';
import type { CliContainer } from './container.js';
import type { CliIo } from './io.js';
import { CliError, cliExitCode, type CliExitCode, type CommandResult } from './model.js';
import { HumanRenderer, JsonRenderer } from './renderer.js';
import { cliOutputJsonSchema } from './schema.js';
/** 模块数据结构或契约。 */
interface GlobalOptions {
  readonly json?: boolean;
  readonly dataRoot?: string;
  readonly config?: string;
}
/** 模块数据结构或契约。 */
interface JobOptions {
  readonly search?: string;
  readonly company?: string;
  readonly status?: string;
  readonly location?: string;
  readonly category?: string;
  readonly minScore?: string;
  readonly profile?: string;
  readonly sort?: string;
  readonly cursor?: string;
  readonly limit?: string;
}

const helpExamples: Readonly<Record<string, readonly string[]>> = {
  init: ['jh --data-root ./var init'],
  doctor: ['jh --json doctor'],
  version: ['jh version'],
  schema: ['jh --json schema'],
  'source list': ['jh --json source list'],
  'source status': ['jh source status tencent-social'],
  'source sync': ['jh source sync tencent-social', 'jh source sync --all --wait'],
  'worker start': ['jh worker start'],
  'task list': ['jh task list --status pending,running --limit 20'],
  'task show': ['jh --json task show <taskId>'],
  'task retry': ['jh task retry <taskId>'],
  'task cancel': ['jh task cancel <taskId>'],
  'job list': ['jh job list --company tencent --location 北京 --limit 20'],
  'job show': ['jh job show <jobId>'],
  'job export': ['jh job export ./exports/jobs.csv --format csv --bom'],
  'resume import': ['jh resume import "./docs/resumes/nowcoder_1787802316450.jpeg"'],
  'profile show': ['jh --json profile show <profileId>'],
  'profile history': ['jh profile history <profileId>'],
  'profile set': ['jh profile set <profileId> /preferences/locations "[\\"北京\\"]"'],
  'profile lock': ['jh profile lock <profileId> /preferences/locations'],
  'profile unlock': ['jh profile unlock <profileId> /preferences/locations'],
  'match score': [
    'jh match score <jobId> --wait',
    'jh match score <jobId> --profile <profileVersionId>',
  ],
  'match list': ['jh match list <profileId> --include-stale --limit 20'],
  'match show': ['jh match show <matchResultId>'],
  'backup create': ['jh backup create "D:\\JobHunter Backups\\backup-001"'],
  'backup list': ['jh backup list "D:\\JobHunter Backups"'],
  'backup verify': ['jh backup verify "D:\\JobHunter Backups\\backup-001"'],
  'backup restore': [
    'jh backup restore <backupDirectory>',
    'jh backup restore <backupDirectory> --confirm <dryRunToken>',
  ],
};

/** 为命令树配置统一帮助输出和错误处理。 */
function configureCommandHelp(command: Command, io: CliIo, prefix = ''): void {
  for (const child of command.commands) {
    const path = prefix ? `${prefix} ${child.name()}` : child.name();
    child.helpOption('-h, --help', '显示帮助信息').configureOutput({
      writeOut: (value) => {
        io.stdout.write(value);
      },
      writeErr: (value) => {
        io.stderr.write(value);
      },
      getOutHelpWidth: () => 160,
      getErrHelpWidth: () => 160,
    });
    const examples = helpExamples[path];
    if (examples)
      child.addHelpText('after', `\n示例：\n${examples.map((item) => `  ${item}`).join('\n')}\n`);
    configureCommandHelp(child, io, path);
  }
}

/** 将逗号分隔选项解析为去空白数组。 */
function commaValues(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/** 将 CLI 职位选项映射为应用层查询筛选条件。 */
function jobFilter(options: JobOptions): Parameters<NonNullable<CliContainer['job']>['list']>[0] {
  const statuses = commaValues(options.status);
  const companies = commaValues(options.company);
  const locations = commaValues(options.location);
  const jobSubfamilies = commaValues(options.category);
  if (statuses?.some((status) => !['active', 'stale', 'closed'].includes(status)))
    throw new CliError({
      code: 'USAGE_ERROR',
      message: '职位状态必须是 active、stale 或 closed。',
      exitCode: cliExitCode.usage,
    });
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  const minimumScore = options.minScore === undefined ? undefined : Number(options.minScore);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))
    throw new CliError({
      code: 'USAGE_ERROR',
      message: 'limit 必须是 1 到 100 的整数。',
      exitCode: cliExitCode.usage,
    });
  if (
    minimumScore !== undefined &&
    (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100)
  )
    throw new CliError({
      code: 'USAGE_ERROR',
      message: 'min-score 必须在 0 到 100 之间。',
      exitCode: cliExitCode.usage,
    });
  if (minimumScore !== undefined && !options.profile)
    throw new CliError({
      code: 'USAGE_ERROR',
      message: '按分数筛选时必须提供 --profile。',
      exitCode: cliExitCode.usage,
    });
  if (options.sort === 'score_desc' && !options.profile)
    throw new CliError({
      code: 'USAGE_ERROR',
      message: '按分数排序时必须提供 --profile。',
      exitCode: cliExitCode.usage,
    });
  if (options.sort && !['updated_desc', 'published_desc', 'score_desc'].includes(options.sort))
    throw new CliError({
      code: 'USAGE_ERROR',
      message: 'sort 必须是 updated_desc、published_desc 或 score_desc。',
      exitCode: cliExitCode.usage,
    });
  return {
    ...(options.search ? { search: options.search } : {}),
    ...(companies ? { companies } : {}),
    ...(statuses ? { statuses: statuses as ('active' | 'stale' | 'closed')[] } : {}),
    ...(locations ? { locations } : {}),
    ...(jobSubfamilies ? { jobSubfamilies } : {}),
    ...(minimumScore === undefined ? {} : { minimumScore }),
    ...(options.profile ? { profileVersionId: options.profile } : {}),
    ...(options.sort
      ? { sort: options.sort as 'updated_desc' | 'published_desc' | 'score_desc' }
      : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

/** 向职位相关命令追加统一筛选和分页参数。 */
function addJobFilterOptions(command: Command, includePagination = true): Command {
  command
    .option('--search <text>', '标题、部门或描述关键词')
    .option('--company <selectors>', '公司 ID、slug、名称或别名，逗号分隔')
    .option('--status <statuses>', 'active、stale、closed，逗号分隔；默认 active,stale')
    .option('--location <locations>', '地点，逗号分隔')
    .option('--category <categories>', '细分职位类别，逗号分隔，例如：算法、后端')
    .option('--min-score <number>', '最低匹配分 0..100，要求 --profile')
    .option('--profile <profileVersionId>', '用于分数查询的画像版本 ID')
    .option('--sort <sort>', 'updated_desc、published_desc、score_desc', 'updated_desc');
  if (includePagination)
    command
      .option('--cursor <cursor>', '上一页返回的不透明游标')
      .option('--limit <number>', '每页数量 1..100', '50');
  return command;
}
/** 将任意异常转换为稳定 CLI 错误。 */
function errorFrom(value: unknown): CliError {
  if (value instanceof CliError) return value;
  if (typeof value === 'object' && value !== null && 'exitCode' in value && value.exitCode === 0)
    return new CliError({
      code: 'CLI_INFORMATION_DISPLAYED',
      message: value instanceof Error ? value.message : '命令信息已显示。',
      exitCode: cliExitCode.success,
      cause: value,
    });
  if (
    value instanceof Error &&
    'code' in value &&
    (value.code === 'commander.helpDisplayed' || value.code === 'commander.version')
  )
    return new CliError({
      code: 'CLI_INFORMATION_DISPLAYED',
      message: value.message,
      exitCode: cliExitCode.success,
      cause: value,
    });
  if (value instanceof Error && value.name === 'CompanyNotFoundError')
    return new CliError({
      code: 'COMPANY_NOT_FOUND',
      message: '公司不存在。',
      exitCode: cliExitCode.notFound,
      cause: value,
    });
  if (value instanceof Error && value.name === 'CandidateProfileNotFoundError')
    return new CliError({
      code: 'PROFILE_NOT_FOUND',
      message: '候选人画像不存在或尚无有效版本。',
      exitCode: cliExitCode.notFound,
      cause: value,
    });
  if (
    value instanceof Error &&
    (value.name === 'MatchProfileNotFoundError' || value.name === 'MatchResultNotFoundError')
  )
    return new CliError({
      code: value.name === 'MatchResultNotFoundError' ? 'MATCH_NOT_FOUND' : 'PROFILE_NOT_FOUND',
      message:
        value.name === 'MatchResultNotFoundError'
          ? '匹配结果不存在。'
          : '候选人画像不存在或尚无有效版本。',
      exitCode: cliExitCode.notFound,
      cause: value,
    });
  if (value instanceof Error && 'code' in value && value.code === 'ENOENT')
    return new CliError({
      code: 'FILE_NOT_FOUND',
      message: '简历文件不存在。',
      exitCode: cliExitCode.notFound,
      cause: value,
    });
  if (value instanceof Error && (value.name === 'DomainError' || value.name === 'ZodError'))
    return new CliError({
      code: 'USAGE_ERROR',
      message: '参数格式或分页游标无效。',
      exitCode: cliExitCode.usage,
      cause: value,
    });
  if (value instanceof CommanderError)
    return new CliError({
      code: 'USAGE_ERROR',
      message: value.message,
      exitCode: value.exitCode === 0 ? cliExitCode.success : cliExitCode.usage,
      cause: value,
    });
  return new CliError({
    code: 'INTERNAL_ERROR',
    message: '命令执行失败，请查看安全日志。',
    exitCode: cliExitCode.internal,
    cause: value,
  });
}

/** 将任务记录压缩为终端可读的一行摘要。 */
function taskHuman(task: TaskRecord): string {
  return `${task.id}\t${task.status}\t${task.taskType}\t${String(task.attemptCount)}/${String(task.maxAttempts)}`;
}

async function waitForTask(input: {
  readonly wait: (taskId: string, signal: AbortSignal) => Promise<TaskRecord | null>;
  readonly taskId: string;
  readonly io: CliIo;
}): Promise<{ readonly task: TaskRecord | null; readonly interrupted: boolean }> {
  const abort = new AbortController();
  const stop = (): void => {
    abort.abort('cli_wait_interrupted');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  input.io.stderr.write(`等待任务 ${input.taskId}；Ctrl+C 仅停止等待，不取消任务。\n`);
  try {
    return { task: await input.wait(input.taskId, abort.signal), interrupted: false };
  } catch (error) {
    if (abort.signal.aborted) return { task: null, interrupted: true };
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
/** 创建 CLI 命令树并绑定本地容器与输入输出。 */
export function createProgram(input: {
  // 1、注册全局选项；2、注册职位/任务/面试准备命令；3、统一挂载帮助和错误处理。
  readonly container: CliContainer;
  readonly io: CliIo;
  readonly onResult: (result: CommandResult) => void;
}): Command {
  const program = new Command();
  program
    .name('jh')
    .description('个人求职 Agent 命令行管理工具')
    .version('0.1.0')
    .helpOption('-h, --help', '显示帮助信息')
    .exitOverride()
    .configureOutput({
      writeOut: (value) => {
        input.io.stdout.write(value);
      },
      writeErr: (value) => {
        input.io.stderr.write(value);
      },
    })
    .addOption(new Option('--json', '输出稳定的机器可读 JSON'))
    .addOption(new Option('--data-root <path>', '数据目录绝对或相对路径'))
    .addOption(new Option('--config <path>', '本地非敏感配置文件路径'));
  program
    .command('source')
    .description('查看来源并手动入队同步')
    .addCommand(
      new Command('list').description('列出全部官网来源').action(() => {
        if (!input.container.source)
          throw new CliError({
            code: 'CONFIGURATION_ERROR',
            message: '来源服务未装配。',
            exitCode: cliExitCode.usage,
          });
        const sources = input.container.source.list();
        input.onResult({
          data: { sources },
          human:
            sources
              .map(
                (source) =>
                  `${source.id}\t${source.companyName}\t${source.channel}\t${source.enabled ? 'enabled' : 'disabled'}\t${source.supportStatus}\t${source.healthStatus}\t${String(source.sources.length)} source(s)`,
              )
              .join('\n') || '没有来源。',
        });
      }),
    )
    .addCommand(
      new Command('status')
        .description('查看来源及最近同步状态')
        .argument('[source]')
        .action((selector?: string) => {
          if (!input.container.source)
            throw new CliError({
              code: 'CONFIGURATION_ERROR',
              message: '来源服务未装配。',
              exitCode: cliExitCode.usage,
            });
          const sources = input.container.source
            .list()
            .filter((source) => !selector || source.id === selector || source.slug === selector);
          if (selector && sources.length === 0)
            throw new CliError({
              code: 'SOURCE_NOT_FOUND',
              message: `来源不存在：${selector}`,
              exitCode: cliExitCode.notFound,
            });
          input.onResult({
            data: { sources },
            human: sources
              .map(
                (source) =>
                  `${source.companyName}\t${source.channel}\t${source.healthStatus}\t${String(source.sources.length)} source(s)`,
              )
              .join('\n'),
          });
        }),
    )
    .addCommand(
      new Command('sync')
        .description('入队单个或全部已启用来源同步')
        .argument('[source]')
        .option('--all', '同步全部已启用来源')
        .option('--wait', '等待任务结束；Ctrl+C 不取消任务')
        .action(
          async (selector: string | undefined, options: { all?: boolean; wait?: boolean }) => {
            if (!input.container.source)
              throw new CliError({
                code: 'CONFIGURATION_ERROR',
                message: '来源服务未装配。',
                exitCode: cliExitCode.usage,
              });
            const sourceService = input.container.source;
            if ((selector ? 1 : 0) + (options.all ? 1 : 0) !== 1)
              throw new CliError({
                code: 'USAGE_ERROR',
                message: '请指定一个来源或使用 --all。',
                exitCode: cliExitCode.usage,
              });
            const queued = sourceService.sync(options.all ? 'all' : (selector ?? ''));
            const waits = [];
            if (options.wait) {
              for (const item of queued)
                waits.push(
                  await waitForTask({
                    wait: (taskId, signal) => sourceService.wait(taskId, signal),
                    taskId: item.task.id,
                    io: input.io,
                  }),
                );
            }
            const terminalFailure = waits.some((item) =>
              item.task ? ['failed', 'cancelled'].includes(item.task.status) : false,
            );
            const interrupted = waits.some((item) => item.interrupted);
            const sourceIds = new Set(
              queued.flatMap((item) => {
                const payload = item.task.payload;
                if (!payload || typeof payload !== 'object' || !('sourceId' in payload)) return [];
                return typeof payload.sourceId === 'string' ? [payload.sourceId] : [];
              }),
            );
            const degraded = sourceService
              .list()
              .some((channel) =>
                channel.sources.some(
                  (source) =>
                    sourceIds.has(source.id) &&
                    (source.lastRun?.status === 'partial' || source.healthStatus === 'degraded'),
                ),
              );
            input.onResult({
              data: { tasks: queued.map((item) => item.task), waits },
              human:
                queued.map((item) => `已入队：${item.task.id}\t${item.task.status}`).join('\n') ||
                '没有已启用来源。',
              ...(terminalFailure
                ? { exitCode: cliExitCode.taskFailed }
                : degraded || interrupted
                  ? { exitCode: cliExitCode.partial }
                  : {}),
            });
          },
        ),
    );

  const task = program.command('task').description('查看和维护后台任务');
  task
    .command('list')
    .description('列出任务')
    .option('--status <statuses>', '状态，逗号分隔')
    .option('--type <taskType>', '任务类型')
    .option('--limit <number>', '返回数量', '50')
    .action((options: { status?: string; type?: string; limit: string }) => {
      if (!input.container.task)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '任务服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const allowed = new Set<TaskStatus>([
        'pending',
        'running',
        'succeeded',
        'failed',
        'cancelled',
      ]);
      const statuses = options.status
        ?.split(',')
        .map((value) => value.trim())
        .filter((value): value is TaskStatus => allowed.has(value as TaskStatus));
      if (options.status && statuses?.length !== options.status.split(',').length)
        throw new CliError({
          code: 'USAGE_ERROR',
          message: '任务状态无效。',
          exitCode: cliExitCode.usage,
        });
      const tasks = input.container.task.list({
        ...(statuses ? { statuses } : {}),
        ...(options.type ? { taskType: options.type } : {}),
        limit: Number(options.limit),
      });
      input.onResult({ data: { tasks }, human: tasks.map(taskHuman).join('\n') || '没有任务。' });
    });
  task
    .command('show')
    .description('显示任务详情')
    .argument('<taskId>')
    .action((taskId: string) => {
      if (!input.container.task)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '任务服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const found = input.container.task.get(taskId);
      if (!found)
        throw new CliError({
          code: 'TASK_NOT_FOUND',
          message: '任务不存在。',
          exitCode: cliExitCode.notFound,
        });
      input.onResult({ data: { task: found }, human: taskHuman(found) });
    });
  task
    .command('retry')
    .description('重试失败任务')
    .argument('<taskId>')
    .action((taskId: string) => {
      if (!input.container.task)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '任务服务未装配。',
          exitCode: cliExitCode.usage,
        });
      if (!input.container.task.get(taskId))
        throw new CliError({
          code: 'TASK_NOT_FOUND',
          message: '任务不存在。',
          exitCode: cliExitCode.notFound,
        });
      const result = input.container.task.retry(taskId);
      input.onResult({ data: result, human: `已创建重试任务：${result.task.id}` });
    });
  task
    .command('cancel')
    .description('取消 pending 任务或请求 running 任务取消')
    .argument('<taskId>')
    .action((taskId: string) => {
      if (!input.container.task)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '任务服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const result = input.container.task.cancel(taskId);
      if (result.kind === 'not_found')
        throw new CliError({
          code: 'TASK_NOT_FOUND',
          message: '任务不存在。',
          exitCode: cliExitCode.notFound,
        });
      input.onResult({ data: result, human: `取消结果：${result.kind}` });
    });

  program
    .command('worker')
    .description('运行后台任务 Worker')
    .addCommand(
      new Command('start')
        .description('启动 Worker；Ctrl+C 或 SIGTERM 优雅关闭')
        .action(async () => {
          if (!input.container.worker)
            throw new CliError({
              code: 'CONFIGURATION_ERROR',
              message: 'Worker 服务未装配。',
              exitCode: cliExitCode.usage,
            });
          input.io.stderr.write('Worker 已启动；按 Ctrl+C 优雅关闭。\n');
          await input.container.worker.start();
          input.onResult({ data: { status: 'stopped' }, human: 'Worker 已停止。' });
        }),
    );

  const job = program.command('job').description('查询和导出职位');
  job.addCommand(
    addJobFilterOptions(new Command('list').description('分页列出职位')).action(
      (options: JobOptions) => {
        if (!input.container.job)
          throw new CliError({
            code: 'CONFIGURATION_ERROR',
            message: '职位查询服务未装配。',
            exitCode: cliExitCode.usage,
          });
        const page = input.container.job.list(jobFilter(options));
        const lines = page.items.map(
          (item) =>
            `${item.id}\t${item.companyName}\t${item.status}\t${item.score === null ? '-' : String(item.score)}\t${item.title}\t${item.locations.join('/')}`,
        );
        if (lines.length > 0) lines.unshift('ID\t公司\t状态\t分数\t职位\t地点');
        if (page.nextCursor) lines.push(`下一页游标：${page.nextCursor}`);
        input.onResult({
          data: page,
          human: lines.join('\n') || '没有符合条件的职位。',
        });
      },
    ),
  );

  program
    .command('resume')
    .description('导入本地脱敏简历并提交画像提取任务')
    .addCommand(
      new Command('import')
        .description('导入 PDF、DOCX 或 UTF-8 TXT；默认上限 10 MiB')
        .argument('<path>')
        .option('--profile <profileId>', '更新已有候选人画像')
        .option('--name <name>', '首次导入时创建的画像名称', '默认候选人画像')
        .option('--wait', '等待画像提取任务结束；Ctrl+C 不取消任务')
        .action(
          async (
            resumePath: string,
            options: { profile?: string; name: string; wait?: boolean },
          ) => {
            if (!input.container.resume)
              throw new CliError({
                code: 'CONFIGURATION_ERROR',
                message: '简历导入服务未装配。',
                exitCode: cliExitCode.usage,
              });
            const result = await input.container.resume.import({
              path: resumePath,
              ...(options.profile ? { profileId: options.profile } : {}),
              profileName: options.name,
              signal: new AbortController().signal,
            });
            let waited: Awaited<ReturnType<typeof waitForTask>> | null = null;
            if (options.wait && result.task) {
              if (!input.container.task)
                throw new CliError({
                  code: 'CONFIGURATION_ERROR',
                  message: '任务等待服务未装配。',
                  exitCode: cliExitCode.usage,
                });
              const taskService = input.container.task;
              waited = await waitForTask({
                wait: (taskId, signal) => taskService.wait(taskId, signal),
                taskId: result.task.id,
                io: input.io,
              });
            }
            const failed = waited?.task
              ? ['failed', 'cancelled'].includes(waited.task.status)
              : false;
            const partial = result.document.parseStatus !== 'parsed' || waited?.interrupted;
            input.onResult({
              data: { ...result, wait: waited },
              human: [
                `简历文档：${result.document.id}（${result.document.parseStatus}）`,
                `候选人画像：${result.profileId}`,
                result.task
                  ? `画像提取任务：${result.task.id}`
                  : '未提交画像任务，请检查解析状态。',
              ].join('\n'),
              ...(failed
                ? { exitCode: cliExitCode.taskFailed }
                : partial
                  ? { exitCode: cliExitCode.partial }
                  : {}),
            });
          },
        ),
    );

  const profile = program.command('profile').description('查看和维护版本化候选人画像');
  profile
    .command('show')
    .description('显示当前有效值、原提取值、锁定路径和 Agent 版本')
    .argument('<profileId>')
    .action((profileId: string) => {
      if (!input.container.profile)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '画像服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const inspection = input.container.profile.show(profileId);
      input.onResult({
        data: inspection,
        human: [
          `画像版本：${String(inspection.version.versionNo)}（${inspection.version.id}）`,
          `来源简历：${inspection.version.resumeDocumentId ?? '-'}`,
          `锁定路径：${inspection.version.lockedPaths.join('、') || '-'}`,
          `目标岗位：${inspection.version.effective.targetRoles.join('、') || '-'}`,
          `目标地点：${inspection.version.effective.preferences.locations.join('、') || '-'}`,
          `技能：${inspection.version.effective.skills.map((skill) => skill.name).join('、') || '-'}`,
        ].join('\n'),
      });
    });
  profile
    .command('history')
    .description('按版本号倒序显示画像历史')
    .argument('<profileId>')
    .action((profileId: string) => {
      if (!input.container.profile)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '画像服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const versions = input.container.profile.history(profileId);
      input.onResult({
        data: { versions },
        human:
          versions
            .map(
              (item) =>
                `v${String(item.version.versionNo)}\t${item.version.id}\t${item.version.lockedPaths.join(',') || '-'}`,
            )
            .join('\n') || '尚无画像版本。',
      });
    });
  profile
    .command('set')
    .description('通过 JSON Pointer 修正字段，并创建新版本')
    .argument('<profileId>')
    .argument('<pointer>', '例如 /preferences/locations')
    .argument('<jsonValue>', 'JSON 值，例如 ["北京","上海"]')
    .action((profileId: string, pointer: string, jsonValue: string) => {
      if (!input.container.profile)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '画像服务未装配。',
          exitCode: cliExitCode.usage,
        });
      let value: unknown;
      try {
        value = JSON.parse(jsonValue) as unknown;
      } catch {
        throw new CliError({
          code: 'USAGE_ERROR',
          message: 'jsonValue 必须是有效 JSON；字符串需要包含 JSON 引号。',
          exitCode: cliExitCode.usage,
        });
      }
      const inspection = input.container.profile.set(profileId, pointer, value);
      input.onResult({
        data: inspection,
        human: `已创建画像版本 v${String(inspection.version.versionNo)}。`,
      });
    });
  for (const operation of ['lock', 'unlock'] as const) {
    profile
      .command(operation)
      .description(`${operation === 'lock' ? '锁定' : '解锁'} JSON Pointer，并创建新版本`)
      .argument('<profileId>')
      .argument('<pointer>')
      .action((profileId: string, pointer: string) => {
        if (!input.container.profile)
          throw new CliError({
            code: 'CONFIGURATION_ERROR',
            message: '画像服务未装配。',
            exitCode: cliExitCode.usage,
          });
        const inspection = input.container.profile[operation](profileId, pointer);
        input.onResult({
          data: inspection,
          human: `${operation === 'lock' ? '已锁定' : '已解锁'} ${pointer}；当前版本 v${String(inspection.version.versionNo)}。`,
        });
      });
  }

  const match = program.command('match').description('查看匹配结果，或为单个职位手动评分');
  match
    .command('score')
    .description('仅为一个具体职位提交匹配评分任务')
    .argument('<jobId>')
    .option('--profile <profileVersionId>', '指定画像版本；默认当前画像版本')
    .option('--wait', '等待任务结束；Ctrl+C 不取消后台任务')
    .action(async (jobId: string, options: { profile?: string; wait?: boolean }) => {
      if (!input.container.match)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '匹配服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const matchService = input.container.match;
      const queued = matchService.scoreForJob({
        jobId,
        ...(options.profile ? { profileVersionId: options.profile } : {}),
      });
      const waited = options.wait
        ? await waitForTask({
            wait: (taskId, signal) => matchService.wait(taskId, signal),
            taskId: queued.task.id,
            io: input.io,
          })
        : null;
      const failed = waited?.task ? ['failed', 'cancelled'].includes(waited.task.status) : false;
      input.onResult({
        data: { task: queued.task, wait: waited },
        human: `匹配任务：${queued.task.id}（${queued.task.status}）`,
        ...(failed
          ? { exitCode: cliExitCode.taskFailed }
          : waited?.interrupted
            ? { exitCode: cliExitCode.partial }
            : {}),
      });
    });
  match
    .command('list')
    .description('按分数、时效和职位 ID 稳定分页显示已手动评分的职位')
    .argument('<profileId>')
    .option('--include-excluded', '包含被硬规则排除的职位')
    .option('--include-stale', '包含 stale 职位')
    .option('--include-closed', '包含 closed 历史职位')
    .option('--cursor <cursor>', '上一页返回的不透明游标')
    .option('--limit <number>', '每页数量 1..100', '50')
    .action(
      (
        profileId: string,
        options: {
          includeExcluded?: boolean;
          includeStale?: boolean;
          includeClosed?: boolean;
          cursor?: string;
          limit: string;
        },
      ) => {
        if (!input.container.match)
          throw new CliError({
            code: 'CONFIGURATION_ERROR',
            message: '匹配服务未装配。',
            exitCode: cliExitCode.usage,
          });
        const limit = Number(options.limit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
          throw new CliError({
            code: 'USAGE_ERROR',
            message: 'limit 必须是 1 到 100 的整数。',
            exitCode: cliExitCode.usage,
          });
        const page = input.container.match.list({
          profileId,
          ...(options.includeExcluded ? { includeExcluded: true } : {}),
          ...(options.includeStale ? { includeStale: true } : {}),
          ...(options.includeClosed ? { includeClosed: true } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          limit,
        });
        const lines = page.items.map(
          (item) =>
            `${item.match.id}\t${String(item.match.totalScore)}\t${item.match.filterStatus}\t${item.jobStatus}\t${item.title}`,
        );
        if (lines.length > 0) lines.unshift('MATCH_ID\t分数\t资格\t职位状态\t职位');
        if (page.nextCursor) lines.push(`下一页游标：${page.nextCursor}`);
        input.onResult({ data: page, human: lines.join('\n') || '没有当前匹配结果。' });
      },
    );
  match
    .command('show')
    .description('显示确定性分项、规则证据和当前 Agent 建议')
    .argument('<matchResultId>')
    .action((matchResultId: string) => {
      if (!input.container.match)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '匹配服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const detail = input.container.match.show(matchResultId);
      const componentLines = detail.match.components.flatMap((component) => [
        `${component.dimension}：${String(component.score)}/${String(component.maximumScore)}`,
        ...component.matchedEvidence.map((evidence) => `  + ${evidence.summary}`),
        ...component.missingEvidence.map((missing) => `  - ${missing}`),
        ...component.uncertainties.map((uncertain) => `  ? ${uncertain}`),
      ]);
      const ruleLines = detail.match.ruleOutcomes.map(
        (rule) =>
          `${rule.ruleId}：${rule.status}${rule.evidence.length > 0 ? `（${rule.evidence.map((item) => item.summary).join('；')}）` : ''}`,
      );
      const advice = detail.advice?.result;
      input.onResult({
        data: detail,
        human: [
          `${detail.job.title}：${String(detail.match.totalScore)} 分（${detail.match.filterStatus}）`,
          `规则集：${detail.rulesetVersion}`,
          '',
          '分项：',
          ...componentLines,
          '',
          '资格规则：',
          ...ruleLines,
          '',
          'Agent 建议：',
          ...(advice
            ? [
                ...advice.highlights.map((item) => `亮点：${item.text}`),
                ...advice.gaps.map((item) => `缺口：${item.text}`),
                ...advice.uncertainties.map((item) => `不确定：${item.text}`),
                ...advice.resumeEmphasis.map((item) => `简历强调：${item}`),
                ...advice.preparation.map((item) => `准备：${item}`),
              ]
            : ['暂无当前模型配置对应的建议。']),
          '',
          `投递：${detail.job.applyUrl}`,
        ].join('\n'),
      });
    });

  const backup = program.command('backup').description('创建、列出、校验和安全恢复本地备份');
  backup
    .command('create')
    .description('创建包含 SQLite 快照和 Artifact 的一致性备份')
    .argument('<directory>', '必须是尚不存在的目标目录')
    .action(async (directory: string) => {
      if (!input.container.backup)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '备份服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const manifest = await input.container.backup.create(directory);
      input.onResult({
        data: { directory, manifest },
        human: `备份已创建：${directory}\nArtifact：${String(manifest.artifacts.length)}`,
      });
    });
  backup
    .command('list')
    .description('列出备份根目录中的 manifest')
    .argument('<root>')
    .action(async (root: string) => {
      if (!input.container.backup)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '备份服务未装配。',
          exitCode: cliExitCode.usage,
        });
      const backups = await input.container.backup.list(root);
      input.onResult({
        data: { backups },
        human:
          backups
            .map(
              (item) =>
                `${item.manifestValid ? 'valid' : 'invalid'}\t${item.createdAt ?? '-'}\t${item.directory}`,
            )
            .join('\n') || '没有备份。',
      });
    });
  backup
    .command('verify')
    .description('重新计算数据库和 Artifact 哈希并校验 manifest')
    .argument('<directory>')
    .action(async (directory: string) => {
      if (!input.container.backup)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '备份服务未装配。',
          exitCode: cliExitCode.usage,
        });
      try {
        const manifest = await input.container.backup.verify(directory);
        input.onResult({
          data: { directory, manifest },
          human: `备份有效：${directory}\n创建时间：${manifest.createdAt}`,
        });
      } catch (error) {
        throw new CliError({
          code: 'BACKUP_VERIFY_FAILED',
          message: '备份不存在、格式无效或内容哈希不匹配。',
          exitCode: cliExitCode.internal,
          cause: error,
        });
      }
    });
  backup
    .command('restore')
    .description('默认仅生成恢复计划；真正恢复必须回传 --confirm 令牌')
    .argument('<backupDirectory>')
    .option('--target <dataRoot>', '恢复目标；默认当前全局 data-root')
    .option('--confirm <token>', '回传 dry-run 生成的短期确认令牌')
    .action(async (backupDirectory: string, options: { target?: string; confirm?: string }) => {
      if (!input.container.backup)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '备份服务未装配。',
          exitCode: cliExitCode.usage,
        });
      try {
        const result = await input.container.backup.restore({
          backupDirectory,
          ...(options.target ? { targetDataRoot: options.target } : {}),
          ...(options.confirm ? { confirmationToken: options.confirm } : {}),
        });
        if ('kind' in result) {
          input.onResult({
            data: { dryRun: true, plan: result },
            human: [
              '恢复 dry-run；尚未修改任何文件。',
              `目标：${result.targetDataRoot}`,
              `数据库：${String(result.counts.databaseFiles)}，Artifact：${String(result.counts.artifacts)}`,
              `字节：${String(result.bytes)}`,
              ...result.warnings.map((warning) => `警告：${warning}`),
              `确认令牌（${new Date(result.expiresAt).toISOString()} 前有效）：${result.confirmationToken}`,
              '停止 Worker/Web/其他 CLI 后，使用同一命令并添加 --confirm <token>。',
            ].join('\n'),
          });
        } else {
          input.onResult({
            data: { dryRun: false, result },
            human: [
              `恢复完成：${result.restoredDataRoot}`,
              `旧数据目录：${result.previousDataRoot ?? '无'}`,
            ].join('\n'),
          });
        }
      } catch (error) {
        throw new CliError({
          code: 'RESTORE_REJECTED',
          message: '恢复被拒绝：请重新 dry-run，并确认所有数据库进程已停止且目标未变化。',
          exitCode: cliExitCode.usage,
          cause: error,
        });
      }
    });
  job
    .command('show')
    .description('显示职位完整详情')
    .argument('<jobId>')
    .option('--profile <profileVersionId>', '同时显示该画像版本的匹配分')
    .action((jobId: string, options: { profile?: string }) => {
      if (!input.container.job)
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '职位查询服务未装配。',
          exitCode: cliExitCode.usage,
        });
      try {
        const detail = input.container.job.show(jobId, options.profile);
        input.onResult({
          data: { job: detail },
          human: [
            `${detail.title}（${detail.companyName}）`,
            `状态：${detail.status}  分数：${detail.score === null ? '-' : String(detail.score)}`,
            `地点：${detail.locations.join('、') || '-'}`,
            `部门/职位类别：${detail.department ?? '-'} / ${detail.jobSubfamily ?? detail.jobFamily ?? '-'}`,
            `经验/学历：${detail.experienceText ?? '-'} / ${detail.educationText ?? '-'}`,
            '',
            detail.description,
            '',
            `详情：${detail.detailUrl}`,
            `投递：${detail.applyUrl}`,
          ].join('\n'),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'JobNotFoundError')
          throw new CliError({
            code: 'JOB_NOT_FOUND',
            message: '职位不存在。',
            exitCode: cliExitCode.notFound,
          });
        throw error;
      }
    });
  job.addCommand(
    addJobFilterOptions(
      new Command('export')
        .description('原子导出全部匹配职位')
        .argument('<path>')
        .requiredOption('--format <format>', 'json 或 csv')
        .option('--bom', 'CSV 添加 UTF-8 BOM；默认关闭'),
      false,
    ).action(
      async (targetPath: string, options: JobOptions & { format: string; bom?: boolean }) => {
        if (!input.container.job)
          throw new CliError({
            code: 'CONFIGURATION_ERROR',
            message: '职位导出服务未装配。',
            exitCode: cliExitCode.usage,
          });
        if (!['json', 'csv'].includes(options.format))
          throw new CliError({
            code: 'USAGE_ERROR',
            message: 'format 必须是 json 或 csv。',
            exitCode: cliExitCode.usage,
          });
        if (options.bom && options.format !== 'csv')
          throw new CliError({
            code: 'USAGE_ERROR',
            message: '--bom 仅适用于 CSV。',
            exitCode: cliExitCode.usage,
          });
        const exported = await input.container.job.export({
          path: targetPath,
          format: options.format as 'json' | 'csv',
          ...(options.bom ? { bom: true } : {}),
          filter: jobFilter(options),
        });
        input.onResult({
          data: exported,
          human: `已导出 ${String(exported.count)} 个职位：${exported.path}`,
        });
      },
    ),
  );

  program
    .command('init')
    .description('创建数据目录、配置、数据库迁移和幂等来源 seed')
    .action(async () => {
      if (!input.container.initialize) {
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: '初始化服务未装配。',
          exitCode: cliExitCode.usage,
        });
      }
      const initialized = await input.container.initialize.run();
      input.onResult({
        data: initialized,
        human: [
          `初始化完成：${initialized.dataRoot}`,
          `数据库：${initialized.databasePath}`,
          `配置：${initialized.configPath}${initialized.configCreated ? '（已创建）' : '（已保留）'}`,
          `来源：${String(initialized.sources)}，公司：${String(initialized.companies)}`,
          ...(initialized.bootstrap
            ? [
                `初始化任务：来源同步 ${String(initialized.bootstrap.sourceSyncTaskIds.length)} 个，默认简历画像 ${initialized.bootstrap.defaultResumeTaskId ?? '未创建'}`,
                `默认计划：${String(initialized.bootstrap.schedules)} 个`,
              ]
            : []),
          '下一步：运行 jh doctor，然后启动 jh worker start。',
        ].join('\n'),
      });
    });
  program
    .command('doctor')
    .description('执行完全离线的运行环境和本地数据检查')
    .action(async () => {
      if (!input.container.doctor) {
        throw new CliError({
          code: 'CONFIGURATION_ERROR',
          message: 'Doctor 服务未装配。',
          exitCode: cliExitCode.usage,
        });
      }
      const report = await input.container.doctor.run();
      input.onResult({
        data: report,
        human: [
          `整体状态：${report.status}`,
          ...report.checks.map(
            (check) =>
              `${check.status === 'healthy' ? '✓' : check.status === 'degraded' ? '!' : '✗'} ${check.key}：${check.summary}${check.recommendation ? ` 建议：${check.recommendation}` : ''}`,
          ),
        ].join('\n'),
        exitCode:
          report.status === 'healthy'
            ? cliExitCode.success
            : report.status === 'degraded'
              ? cliExitCode.partial
              : cliExitCode.internal,
      });
    });
  program
    .command('version')
    .description('显示应用、运行时和数据版本')
    .action(() => {
      const versions = input.container.version.get();
      input.onResult({
        data: { versions },
        human: Object.entries(versions)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n'),
      });
    });
  program
    .command('schema')
    .description('输出 --json 稳定 envelope 的 JSON Schema')
    .action(() => {
      input.onResult({
        data: { schema: cliOutputJsonSchema },
        human: '请使用 jh --json schema 获取机器可读 JSON Schema。',
      });
    });
  program.addHelpText(
    'after',
    '\n全局示例：\n  jh --data-root ./var init\n  jh --json job list --limit 20\n  jh <command> --help\n\n退出码：0 成功；1 内部错误；2 用法/配置；3 未找到；4 部分成功/退化；5 任务最终失败。\n',
  );
  configureCommandHelp(program, input.io);
  return program;
}
export async function runCli(input: {
  readonly argv: readonly string[];
  readonly container: CliContainer;
  readonly io: CliIo;
}): Promise<CliExitCode> {
  const results: CommandResult[] = [];
  const program = createProgram({
    container: input.container,
    io: input.io,
    onResult: (value) => {
      results.push(value);
    },
  });
  try {
    const helpIndex = input.argv.findIndex(
      (argument) => argument === '--help' || argument === '-h',
    );
    if (helpIndex >= 0) {
      let helpCommand = program;
      for (let index = 0; index < helpIndex; index += 1) {
        const argument = input.argv[index];
        if (argument === '--data-root' || argument === '--config') {
          index += 1;
          continue;
        }
        if (!argument || argument.startsWith('-')) continue;
        const child = helpCommand.commands.find((command) => command.name() === argument);
        if (!child) break;
        helpCommand = child;
      }
      helpCommand.outputHelp();
      return cliExitCode.success;
    }
    await program.parseAsync([...input.argv], { from: 'user' });
    const result = results.at(-1);
    if (!result) return cliExitCode.success;
    const renderer = program.opts<GlobalOptions>().json
      ? new JsonRenderer(input.io)
      : new HumanRenderer(input.io);
    renderer.success(result);
    return result.exitCode ?? cliExitCode.success;
  } catch (value) {
    const error = errorFrom(value);
    if (error.exitCode === cliExitCode.success) return cliExitCode.success;
    const renderer = program.opts<GlobalOptions>().json
      ? new JsonRenderer(input.io)
      : new HumanRenderer(input.io);
    renderer.failure(error.body());
    return error.exitCode;
  } finally {
    await input.container.close();
  }
}
