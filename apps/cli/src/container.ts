import { createAiReplyHandler } from '@jobhunter/user/ai/handler';
import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { agentDefinitionHash } from '@jobhunter/common/agent';
import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteJobScoreReader } from '@jobhunter/matching/persistence/job-score-reader';
import {
  CandidateProfileService,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  ProfileInspectionService,
  ProfileManagementService,
  ResumeImportService,
  ResumeProfileWorkflow,
} from '@jobhunter/user/profile';
import { BackupService } from '@jobhunter/common/operations/backup-service';
import { createCleanupTaskHandler } from '@jobhunter/common/operations/cleanup-handler';
import { createExperienceResearchTaskHandler } from '@jobhunter/user/interview';
import {
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createBatchJobScoreTaskHandler,
  createJobUnderstandingTaskHandler,
  createJobAdviceTaskHandler,
  MatchWorkflowService,
} from '@jobhunter/matching/application';
import { dataRootCheck, nodeRuntimeCheck } from '@jobhunter/common/operations/offline-checks';
import {
  InitializationService,
  type InitializationResult,
} from '@jobhunter/common/operations/initialization-service';
import {
  modelConfigurationCheck,
  OfflineDoctorService,
  type DoctorReport,
} from '@jobhunter/common/operations/doctor-service';
import type { AppConfig } from '@jobhunter/common/config/index';
import {
  HandlerRegistry,
  ScheduleService,
  TaskService,
  type EnqueueTaskResult,
  type TaskListFilter,
  type TaskRecord,
} from '@jobhunter/common/tasks';
import { JobExportService, JobQueryService } from '@jobhunter/recruitment/jobs/job-query-service';
import { ProfileJobIntakePolicy } from '@jobhunter/matching/profile-job-intake-policy';
import {
  SourceManagementService,
  TaskWaitService,
} from '@jobhunter/recruitment/source-management-service';
import { SourceScheduleReconciliationService } from '@jobhunter/recruitment/sync/source-schedule-reconciliation-service';
import { SystemSettingsService } from '@jobhunter/recruitment/settings';
import { createSourceSyncTaskHandler } from '@jobhunter/recruitment/sync/job-sync-handler';
import type { SourceChannelOverview } from '@jobhunter/recruitment/ports/source-management';
import { NodeResumeFileReader } from '@jobhunter/user/persistence/resume-file-reader';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { sqliteFileDoctorCheck } from '@jobhunter/common/persistence/doctor-check';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteBackupOperations } from '@jobhunter/common/persistence/backup-operations';
import { SqliteArtifactStore } from '@jobhunter/user/persistence/artifact-store';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteSourceManagementRepository } from '@jobhunter/recruitment/persistence/source-management-repository';
import {
  SqliteCompanyLookupRepository,
  SqliteJobQueryRepository,
} from '@jobhunter/recruitment/persistence/job-query-repository';
import { SqliteInterviewTaskRetryCoordinator } from '@jobhunter/user/persistence/interview-task-retry-coordinator';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';
import { SqliteResumeDocumentRepository } from '@jobhunter/user/persistence/resume-document-repository';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { SqliteSettingsStore } from '@jobhunter/recruitment/persistence/settings';
import { NodeJobExportFileStore } from '@jobhunter/recruitment/persistence/node-job-export-file-store';
import { SqliteSystemInitializer } from './initializer.js';
import { parseId, SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import { hashCanonical } from '@jobhunter/common/agent';
import { createConfiguredModelClient } from '@jobhunter/common/models';
import { jobAdviceAgentDefinition } from '@jobhunter/matching';
import { firstPartySourceCatalog } from '@jobhunter/recruitment';
import {
  ensureConfiguredTaskService,
  requestTaskService,
  stopTaskService,
  taskServiceConfiguration,
  TaskServiceConnectionError,
} from '@jobhunter/common/task-service';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CliError, cliExitCode } from './model.js';

/** 模块数据结构或契约。 */
export interface CliContainer {
  readonly version: { get(): Readonly<Record<string, string>> };
  readonly initialize?: { run(): Promise<InitializationResult> };
  readonly doctor?: { run(): Promise<DoctorReport> };
  readonly source?: {
    list(): readonly SourceChannelOverview[];
    /** 执行模块适配器的该项操作。 */
    sync(selector: string): readonly EnqueueTaskResult[] | Promise<readonly EnqueueTaskResult[]>;
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly task?: {
    list(filter?: TaskListFilter): readonly TaskRecord[];
    get(taskId: string): TaskRecord | null;
    retry(taskId: string): EnqueueTaskResult | Promise<EnqueueTaskResult>;
    cancel(taskId: string): ReturnType<TaskService['cancel']>;
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly taskService?: {
    status(): Promise<{ readonly status: 'ready' | 'unavailable' | 'incompatible' }>;
    stop(): Promise<void>;
    restart(): Promise<void>;
  };
  readonly job?: {
    list(input: Parameters<JobQueryService['list']>[0]): ReturnType<JobQueryService['list']>;
    show(id: string, profileVersionId?: string): ReturnType<JobQueryService['show']>;
    export(
      input: Parameters<JobExportService['export']>[0],
    ): ReturnType<JobExportService['export']>;
  };
  readonly resume?: {
    import(
      input: Parameters<ResumeProfileWorkflow['import']>[0],
    ): ReturnType<ResumeProfileWorkflow['import']>;
  };
  readonly profile?: {
    show(id: string): ReturnType<ProfileManagementService['show']>;
    history(id: string): ReturnType<ProfileManagementService['history']>;
    confirm(
      id: string,
      candidateVersionId: string,
      expectedVersionId: string,
      fields: readonly string[],
    ): ReturnType<ProfileManagementService['confirm']>;
    set(id: string, pointer: string, value: unknown): ReturnType<ProfileManagementService['set']>;
  };
  readonly match?: {
    scoreForJob(
      input: Parameters<MatchWorkflowService['runForJob']>[0],
    ):
      | ReturnType<MatchWorkflowService['runForJob']>
      | Promise<ReturnType<MatchWorkflowService['runForJob']>>;
    list(
      input: Parameters<MatchWorkflowService['list']>[0],
    ): ReturnType<MatchWorkflowService['list']>;
    show(id: string): ReturnType<MatchWorkflowService['show']>;
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly backup?: {
    /** 执行模块适配器的该项操作。 */
    create(destination: string): ReturnType<BackupService['create']>;
    list(root: string): ReturnType<BackupService['list']>;
    verify(directory: string): ReturnType<BackupService['verify']>;
    restore(input: {
      readonly backupDirectory: string;
      readonly targetDataRoot?: string;
      readonly confirmationToken?: string;
    }): ReturnType<BackupService['restore']>;
  };
  close(): Promise<void>;
}

/** 打开本地数据库并装配完整 CLI 应用服务。 */
export function createLocalCliContainer(
  config: AppConfig,
  options: { readonly workspaceRoot?: string } = {},
): CliContainer {
  const initialization = new InitializationService(
    new SqliteSystemInitializer(firstPartySourceCatalog),
  );
  const versions = { app: '0.1.0', schema: '0000', ruleset: 'v1', prompt: '1.0.0' };
  const ids = new SystemIdGenerator();
  const workspaceRoot = path.resolve(
    process.env.JOBHUNTER_WORKSPACE_ROOT ?? options.workspaceRoot ?? process.cwd(),
  );
  const backups = new BackupService(new SqliteBackupOperations(config.bootstrap.dataRoot.value));
  let database: SqliteDatabaseHandle | null = null;
  let services: {
    readonly sources: SourceManagementService;
    readonly tasks: TaskService;
    readonly wait: TaskWaitService;
    readonly jobs: JobQueryService;
    readonly jobExports: JobExportService;
    readonly resumes: ResumeProfileWorkflow;
    readonly profiles: ProfileManagementService;
    readonly matches: MatchWorkflowService;
    readonly schedules: ScheduleService;
  } | null = null;
  const operational = (): NonNullable<typeof services> => {
    if (services) return services;
    const databasePath = path.join(config.bootstrap.dataRoot.value, 'jobhunter.sqlite');
    if (!existsSync(databasePath)) {
      throw new CliError({
        code: 'NOT_INITIALIZED',
        message: '数据目录尚未初始化，请先运行 jh init。',
        exitCode: cliExitCode.usage,
      });
    }
    database = openSqliteDatabase({ dataRoot: config.bootstrap.dataRoot.value });
    const systemSettings = new SystemSettingsService({
      repository: new SqliteSettingsStore(database.client),
      clock: { now: () => utcInstant(Date.now()) },
    });
    systemSettings.applySourceSyncChannelSelection();
    const queue = new SqliteTaskRepository(database.client);
    const registry = new HandlerRegistry();
    registry.register(
      createSourceSyncTaskHandler({
        run: () =>
          Promise.reject(new Error('CLI process does not execute source synchronization.')),
      }),
    );
    registry.register(createCleanupTaskHandler({ unavailable: true }));
    registry.register(createResumeProfileTaskHandler({ unavailable: true }));
    registry.register(createResumePolishTaskHandler({ unavailable: true }));
    registry.register(createExperienceResearchTaskHandler({ unavailable: true }));
    registry.register(createAiReplyHandler({}));
    const matchingHandler = createMatchRevisionTaskHandler(null);
    const understandingHandler = createJobUnderstandingTaskHandler({ unavailable: true });
    const adviceHandler = createJobAdviceTaskHandler({ unavailable: true });
    registry.register(matchingHandler);
    registry.register(understandingHandler);
    registry.register(adviceHandler);
    const singleScoring = createManualJobScoreTaskHandler({
      understanding: understandingHandler,
      matching: matchingHandler,
      advice: adviceHandler,
      adviceEnabled: () => systemSettings.get().matchingAutomation.adviceEnabled,
    });
    registry.register(singleScoring);
    registry.register(createBatchJobScoreTaskHandler(singleScoring));
    const tasks = new TaskService(
      { queue, clock: { now: () => utcInstant(Date.now()) }, ids },
      registry,
      null,
      new SqliteInterviewTaskRetryCoordinator(database.client, queue),
    );
    const schedules = new ScheduleService(
      { queue, clock: { now: () => utcInstant(Date.now()) }, ids },
      registry,
    );
    const profileRepository = new SqliteCandidateProfileRepository(
      database.client,
      new SqliteProfileDerivedDataManager(database.client),
    );
    const jobIntakePolicy = new ProfileJobIntakePolicy(profileRepository);
    const sources = new SourceManagementService({
      sources: new SqliteSourceManagementRepository(database.client),
      tasks,
      ids,
      jobIntakePolicy,
      activeChannel: () => systemSettings.get().sourceSync.channel,
    });
    new SourceScheduleReconciliationService({
      sources: new SqliteSourceManagementRepository(database.client),
      schedules,
      jobIntakePolicy,
      activeChannel: () => systemSettings.get().sourceSync.channel,
      automation: () => systemSettings.get().sourceAutomation,
      overrides: () => systemSettings.sourceScheduleOverrides(),
    }).reconcile();
    const jobRepository = new SqliteJobQueryRepository(
      database.client,
      new SqliteJobScoreReader(database.client),
    );
    const jobs = new JobQueryService({
      jobs: jobRepository,
      companies: new SqliteCompanyLookupRepository(database.client),
    });
    const candidateProfiles = new CandidateProfileService({
      repository: profileRepository,
      clock: { now: () => utcInstant(Date.now()) },
      ids,
    });
    const profileInspection = new ProfileInspectionService({
      profiles: profileRepository,
      agentRuns: new SqliteAgentRunStore(database.client),
    });
    const resumeDocuments = new SqliteResumeDocumentRepository(database.client);
    const matchingRepository = new SqliteMatchingRepository(
      database.client,
      new SqliteMatchingJobReader(database.client),
      new SqliteProfileIdentityReader(database.client),
      new SqliteAgentRunStore(database.client),
    );
    const modelMetadata =
      config.model.modelName.value && config.model.apiKey.value
        ? createConfiguredModelClient({
            provider: config.model.provider.value,
            baseUrl: config.model.baseUrl.value,
            model: config.model.modelName.value,
            apiKey: config.model.apiKey.value.reveal(),
            cacheReadPrice:
              config.model.cacheReadPrice.source === 'default'
                ? undefined
                : config.model.cacheReadPrice.value,
            cacheWritePrice:
              config.model.cacheWritePrice.source === 'default'
                ? undefined
                : config.model.cacheWritePrice.value,
            cacheWrite1hPrice:
              config.model.cacheWrite1hPrice.source === 'default'
                ? undefined
                : config.model.cacheWrite1hPrice.value,
            autoModelPricing:
              config.model.inputCostPerMillionUsd.source === 'default' &&
              config.model.outputCostPerMillionUsd.source === 'default',
            inputCostPerMillionUsd: config.model.inputCostPerMillionUsd.value,
            outputCostPerMillionUsd: config.model.outputCostPerMillionUsd.value,
            costCurrency: config.model.costCurrency.value,
          }).metadata
        : null;
    services = {
      sources,
      tasks,
      jobs,
      jobExports: new JobExportService({
        jobs: jobRepository,
        query: jobs,
        files: new NodeJobExportFileStore(),
      }),
      resumes: new ResumeProfileWorkflow({
        files: new NodeResumeFileReader(),
        imports: new ResumeImportService({
          artifacts: new SqliteArtifactStore(database.client, config.bootstrap.dataRoot.value),
          documents: resumeDocuments,
          clock: { now: () => utcInstant(Date.now()) },
          ids,
        }),
        profiles: candidateProfiles,
        tasks,
      }),
      profiles: new ProfileManagementService({
        profiles: candidateProfiles,
        inspection: profileInspection,
      }),
      matches: new MatchWorkflowService({
        matching: matchingRepository,
        profiles: profileRepository,
        tasks,
        ids,
        ...(modelMetadata
          ? {
              adviceSelector: {
                agentKey: jobAdviceAgentDefinition.key,
                definitionHash: agentDefinitionHash(jobAdviceAgentDefinition),
                modelConfigHash: hashCanonical(modelMetadata),
              },
            }
          : {}),
      }),
      wait: new TaskWaitService(tasks, {
        wait: (milliseconds, signal) => setTimeout(milliseconds, undefined, { signal }),
      }),
      schedules,
    };
    return services;
  };
  /** 提交和等待均确认中央服务可用，命令退出不停止后台执行。 */
  async function ensureService(signal?: AbortSignal): Promise<void> {
    operational();
    await ensureConfiguredTaskService(config, {
      entry: new URL(
        import.meta.url.endsWith('.ts') ? './task-service-main.ts' : './task-service-main.js',
        import.meta.url,
      ),
      workspaceRoot,
      ...(signal ? { signal } : {}),
    });
  }
  /** 等待只连接共享中央服务，不在 CLI 内领取任务。 */
  async function waitForTask(taskId: string, signal: AbortSignal): Promise<TaskRecord | null> {
    await ensureService(signal);
    return operational().wait.wait(parseId(taskId, 'Task'), signal);
  }
  return {
    version: { get: () => ({ ...versions, node: process.versions.node }) },
    initialize: {
      run: async () => {
        const initialized = await initialization.initialize({
          dataRoot: config.bootstrap.dataRoot.value,
        });
        const runtime = operational();
        const defaultResumePath = [
          path.join(workspaceRoot, 'docs', 'resumes', 'nowcoder_1787802316450.jpeg'),
          path.join(workspaceRoot, 'docs', 'resumes', 'agent简历 - 新.docx'),
        ].find((candidate) => existsSync(candidate));
        let defaultResumeTaskId: string | null = null;
        if (defaultResumePath) {
          const imported = await runtime.resumes.import({
            path: defaultResumePath,
            signal: new AbortController().signal,
          });
          defaultResumeTaskId = imported.task?.id ?? null;
        }
        const sourceSyncReady = runtime.sources.isSyncReady();
        const sourceSyncTasks = sourceSyncReady
          ? runtime.sources.enqueueChannelSync({
              channelIds: 'all',
              idempotencyToken: 'bootstrap-initialization-v1',
            })
          : [];
        let schedules = 0;
        if (sourceSyncReady) {
          const sources = runtime.sources.list().filter((candidate) => candidate.effectiveEnabled);
          const kuaishouIntern = [
            ...sources.filter((source) => source.adapterKey === 'kuaishou.intern'),
            ...sources.filter((source) => source.adapterKey === 'kuaishou.intern.campus'),
          ];
          const grouped = kuaishouIntern.length === 2;
          for (const source of sources.filter(
            (candidate) => !grouped || !candidate.adapterKey.startsWith('kuaishou.intern'),
          )) {
            runtime.schedules.upsert({
              id: source.id,
              scheduleKey: `source.sync:${source.id}`,
              taskType: 'source.sync',
              payload: { sourceId: source.id, trigger: 'schedule' },
              cronExpression: '0 3 * * *',
              timezone: 'Asia/Shanghai',
              enabled: true,
            });
            schedules += 1;
          }
          if (grouped) {
            const [primary, campus] = kuaishouIntern;
            if (!primary || !campus) throw new Error('Kuaishou intern sources are incomplete.');
            runtime.schedules.upsert({
              id: campus.id,
              scheduleKey: `source.sync:${campus.id}`,
              taskType: 'source.sync',
              payload: { sourceId: campus.id, trigger: 'schedule' },
              cronExpression: '0 3 * * *',
              timezone: 'Asia/Shanghai',
              enabled: false,
            });
            runtime.schedules.upsert({
              id: primary.id,
              scheduleKey: `source.sync:${primary.id}`,
              taskType: 'source.sync',
              payload: {
                sourceIds: [primary.id, campus.id],
                trigger: 'schedule',
              },
              cronExpression: '0 3 * * *',
              timezone: 'Asia/Shanghai',
              enabled: true,
            });
            schedules += 1;
          }
        }
        runtime.schedules.upsert({
          id: '018f0000-0000-7000-8000-000000000401',
          scheduleKey: 'maintenance.cleanup:weekly',
          taskType: 'maintenance.cleanup',
          payload: { sourceDetailsDays: 30, observationsDays: 90, failedAgentRunsDays: 30 },
          cronExpression: '0 4 * * 0',
          timezone: 'Asia/Shanghai',
          enabled: true,
        });
        await ensureService();
        return {
          ...initialized,
          bootstrap: {
            defaultResumeTaskId,
            sourceSyncTaskIds: sourceSyncTasks.map((result) => result.task.id),
            schedules: schedules + 1,
          },
        };
      },
    },
    doctor: {
      run: () =>
        new OfflineDoctorService({
          checks: [
            nodeRuntimeCheck(),
            dataRootCheck(config.bootstrap.dataRoot.value),
            sqliteFileDoctorCheck(config.bootstrap.dataRoot.value),
            modelConfigurationCheck(
              config.model.modelName.value !== null && config.model.apiKey.value !== null,
            ),
          ],
          versions,
        }).run(),
    },
    source: {
      list: () => operational().sources.listChannels(),
      sync: async (selector) => {
        await ensureService();
        const service = operational().sources;
        if (selector === 'all') return service.enqueueChannelSync({ channelIds: 'all' });
        const channel = service
          .listChannels()
          .find((candidate) => candidate.id === selector || candidate.slug === selector);
        if (channel) return service.enqueueChannelSync({ channelIds: [channel.id] });
        const source = service
          .list()
          .find((candidate) => candidate.id === selector || candidate.slug === selector);
        if (!source) {
          throw new CliError({
            code: 'SOURCE_NOT_FOUND',
            message: `来源不存在：${selector}`,
            exitCode: cliExitCode.notFound,
          });
        }
        return service.enqueueSync({ sourceIds: [source.id] });
      },
      wait: (taskId, signal) => waitForTask(taskId, signal),
    },
    task: {
      list: (filter) => operational().tasks.list(filter),
      get: (taskId) => operational().tasks.get(parseId(taskId, 'Task')),
      retry: async (taskId) => {
        await ensureService();
        return operational().tasks.retryFailed(parseId(taskId, 'Task'), ids.generate());
      },
      cancel: (taskId) => operational().tasks.cancel(parseId(taskId, 'Task')),
      wait: (taskId, signal) => waitForTask(taskId, signal),
    },
    taskService: {
      async status() {
        try {
          await requestTaskService({
            dataRoot: config.bootstrap.dataRoot.value,
            configuration: taskServiceConfiguration(config),
            method: 'ping',
          });
          return { status: 'ready' };
        } catch (error) {
          if (
            error instanceof TaskServiceConnectionError &&
            (error.code === 'unavailable' || error.code === 'incompatible')
          )
            return { status: error.code };
          throw error;
        }
      },
      stop: () =>
        stopTaskService({
          dataRoot: config.bootstrap.dataRoot.value,
          configuration: taskServiceConfiguration(config),
        }),
      async restart() {
        await stopTaskService({
          dataRoot: config.bootstrap.dataRoot.value,
          configuration: taskServiceConfiguration(config),
        });
        await ensureService();
      },
    },
    job: {
      list: (input) => operational().jobs.list(input),
      show: (id, profileVersionId) => operational().jobs.show(id, profileVersionId),
      export: (input) => operational().jobExports.export(input),
    },
    resume: {
      import: async (input) => {
        await ensureService(input.signal);
        return operational().resumes.import(input);
      },
    },
    profile: {
      show: (id) => operational().profiles.show(id),
      history: (id) => operational().profiles.history(id),
      confirm: (id, candidateVersionId, expectedVersionId, fields) =>
        operational().profiles.confirm(id, candidateVersionId, expectedVersionId, fields),
      set: (id, pointer, value) => operational().profiles.set(id, pointer, value),
    },
    match: {
      scoreForJob: async (input) => {
        await ensureService();
        return operational().matches.runForJob(input);
      },
      list: (input) => operational().matches.list(input),
      show: (id) => operational().matches.show(id),
      wait: (taskId, signal) => waitForTask(taskId, signal),
    },
    backup: {
      create: (destination) => backups.create(destination),
      list: (root) => backups.list(root),
      verify: (directory) => backups.verify(directory),
      restore: (input) =>
        backups.restore({
          backupDirectory: input.backupDirectory,
          targetDataRoot: input.targetDataRoot ?? config.bootstrap.dataRoot.value,
          ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {}),
        }),
    },
    close: () => {
      // 客户端只关闭自己的查询连接，后台服务独立存活。
      database?.close();
      return Promise.resolve();
    },
  };
}
/** 创建无需数据库的最小容器，供帮助或纯解析命令使用。 */
export function createMinimalCliContainer(): CliContainer {
  return {
    version: { get: () => ({ app: '0.1.0', node: process.versions.node }) },
    close: () => Promise.resolve(),
  };
}
