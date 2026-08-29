import {
  CandidateProfileService,
  BackupService,
  createCleanupTaskHandler,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createJobUnderstandingTaskHandler,
  createJobAdviceTaskHandler,
  dataRootCheck,
  InitializationService,
  modelConfigurationCheck,
  nodeRuntimeCheck,
  OfflineDoctorService,
  type AppConfig,
  type DoctorReport,
  type InitializationResult,
  HandlerRegistry,
  JobExportService,
  JobQueryService,
  MatchWorkflowService,
  ProfileInspectionService,
  ProfileManagementService,
  ProfileJobIntakePolicy,
  ResumeImportService,
  ResumeProfileWorkflow,
  ScheduleService,
  SourceManagementService,
  SourceScheduleReconciliationService,
  SystemSettingsService,
  TaskService,
  TaskWaitService,
  createSourceSyncTaskHandler,
  type EnqueueTaskResult,
  type SourceChannelOverview,
  type TaskListFilter,
  type TaskRecord,
} from '@jobhunter/application';
import {
  NodeResumeFileReader,
  openSqliteDatabase,
  sqliteFileDoctorCheck,
  SqliteAgentRunStore,
  SqliteBackupOperations,
  SqliteArtifactStore,
  SqliteCandidateProfileRepository,
  SqliteSourceManagementRepository,
  SqliteCompanyLookupRepository,
  SqliteJobQueryRepository,
  SqliteMatchingRepository,
  SqliteResumeDocumentRepository,
  SqliteSystemInitializer,
  SqliteTaskRepository,
  SqliteSettingsStore,
  type SqliteDatabaseHandle,
  NodeJobExportFileStore,
} from '@jobhunter/db';
import { parseId, SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { hashCanonical } from '@jobhunter/agent-core';
import { createConfiguredModelClient } from '@jobhunter/llm';
import { jobAdviceAgentDefinition } from '@jobhunter/matching';
import { createSafeLogger } from '@jobhunter/observability';
import { firstPartySourceCatalog } from '@jobhunter/sources';
import {
  createPlaywrightSourcePageClient,
  createProductionWorkerApplication,
  runWorkerProcess,
} from '@jobhunter/worker';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { CliError, cliExitCode } from './model.js';

export interface CliContainer {
  readonly version: { get(): Readonly<Record<string, string>> };
  readonly initialize?: { run(): Promise<InitializationResult> };
  readonly doctor?: { run(): Promise<DoctorReport> };
  readonly source?: {
    list(): readonly SourceChannelOverview[];
    sync(selector: string): readonly EnqueueTaskResult[];
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly task?: {
    list(filter?: TaskListFilter): readonly TaskRecord[];
    get(taskId: string): TaskRecord | null;
    retry(taskId: string): EnqueueTaskResult;
    cancel(taskId: string): ReturnType<TaskService['cancel']>;
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly worker?: { start(): Promise<void> };
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
    set(id: string, pointer: string, value: unknown): ReturnType<ProfileManagementService['set']>;
    lock(id: string, pointer: string): ReturnType<ProfileManagementService['lock']>;
    unlock(id: string, pointer: string): ReturnType<ProfileManagementService['unlock']>;
  };
  readonly match?: {
    scoreForJob(
      input: Parameters<MatchWorkflowService['runForJob']>[0],
    ): ReturnType<MatchWorkflowService['runForJob']>;
    list(
      input: Parameters<MatchWorkflowService['list']>[0],
    ): ReturnType<MatchWorkflowService['list']>;
    show(id: string): ReturnType<MatchWorkflowService['show']>;
    wait(taskId: string, signal: AbortSignal): Promise<TaskRecord | null>;
  };
  readonly backup?: {
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
    const matchingHandler = createMatchRevisionTaskHandler(null);
    const understandingHandler = createJobUnderstandingTaskHandler({ unavailable: true });
    const adviceHandler = createJobAdviceTaskHandler({ unavailable: true });
    registry.register(matchingHandler);
    registry.register(understandingHandler);
    registry.register(adviceHandler);
    registry.register(
      createManualJobScoreTaskHandler({
        understanding: understandingHandler,
        matching: matchingHandler,
        advice: adviceHandler,
      }),
    );
    const tasks = new TaskService(
      { queue, clock: { now: () => utcInstant(Date.now()) }, ids },
      registry,
    );
    const schedules = new ScheduleService(
      { queue, clock: { now: () => utcInstant(Date.now()) }, ids },
      registry,
    );
    const profileRepository = new SqliteCandidateProfileRepository(database.client);
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
    }).reconcile();
    const jobRepository = new SqliteJobQueryRepository(database.client);
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
    const matchingRepository = new SqliteMatchingRepository(database.client);
    const modelMetadata =
      config.model.provider.value &&
      config.model.baseUrl.value &&
      config.model.modelName.value &&
      config.model.apiKey.value
        ? createConfiguredModelClient({
            provider: config.model.provider.value,
            baseUrl: config.model.baseUrl.value,
            model: config.model.modelName.value,
            apiKey: config.model.apiKey.value.reveal(),
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
                agentVersion: jobAdviceAgentDefinition.version,
                promptVersion: jobAdviceAgentDefinition.promptVersion,
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
  return {
    version: { get: () => ({ ...versions, node: process.versions.node }) },
    initialize: {
      run: async () => {
        const initialized = await initialization.initialize({
          dataRoot: config.bootstrap.dataRoot.value,
          configPath: config.bootstrap.configPath.value,
          defaultConfig: {
            logLevel: 'info',
            worker: {
              pollIntervalMs: 1_000,
              maxConcurrentNetworkTasks: 4,
              taskTypeConcurrency: {},
            },
          },
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
          for (const source of runtime.sources
            .list()
            .filter((candidate) => candidate.effectiveEnabled)) {
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
        }
        runtime.schedules.upsert({
          id: '018f0000-0000-7000-8000-000000000401',
          scheduleKey: 'maintenance.cleanup:weekly',
          taskType: 'maintenance.cleanup',
          payload: { rawRecordsDays: 30, observationsDays: 90, failedAgentRunsDays: 30 },
          cronExpression: '0 4 * * 0',
          timezone: 'Asia/Shanghai',
          enabled: true,
        });
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
              config.model.provider.value !== null &&
                config.model.baseUrl.value !== null &&
                config.model.modelName.value !== null &&
                config.model.apiKey.value !== null,
            ),
          ],
          versions,
        }).run(),
    },
    source: {
      list: () => operational().sources.listChannels(),
      sync: (selector) => {
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
      wait: (taskId, signal) => operational().wait.wait(parseId(taskId, 'Task'), signal),
    },
    task: {
      list: (filter) => operational().tasks.list(filter),
      get: (taskId) => operational().tasks.get(parseId(taskId, 'Task')),
      retry: (taskId) => operational().tasks.retryFailed(parseId(taskId, 'Task'), ids.generate()),
      cancel: (taskId) => operational().tasks.cancel(parseId(taskId, 'Task')),
      wait: (taskId, signal) => operational().wait.wait(parseId(taskId, 'Task'), signal),
    },
    worker: {
      start: async () => {
        operational();
        const logger = createSafeLogger({
          level: config.logLevel.value,
          logFile: path.join(config.bootstrap.dataRoot.value, 'logs', 'jobhunter.log'),
        });
        try {
          await runWorkerProcess(
            createProductionWorkerApplication({
              dataRoot: config.bootstrap.dataRoot.value,
              pollIntervalMs: config.worker.pollIntervalMs.value,
              maxConcurrentNetworkTasks: config.worker.maxConcurrentNetworkTasks.value,
              taskTypeConcurrency: config.worker.taskTypeConcurrency.value,
              logger,
              pageClient: createPlaywrightSourcePageClient(),
              ...(config.model.provider.value &&
              config.model.baseUrl.value &&
              config.model.modelName.value &&
              config.model.apiKey.value
                ? {
                    model: {
                      provider: config.model.provider.value,
                      baseUrl: config.model.baseUrl.value,
                      model: config.model.modelName.value,
                      apiKey: config.model.apiKey.value.reveal(),
                    },
                  }
                : {}),
            }),
          );
        } finally {
          await logger.close();
        }
      },
    },
    job: {
      list: (input) => operational().jobs.list(input),
      show: (id, profileVersionId) => operational().jobs.show(id, profileVersionId),
      export: (input) => operational().jobExports.export(input),
    },
    resume: {
      import: (input) => operational().resumes.import(input),
    },
    profile: {
      show: (id) => operational().profiles.show(id),
      history: (id) => operational().profiles.history(id),
      set: (id, pointer, value) => operational().profiles.set(id, pointer, value),
      lock: (id, pointer) => operational().profiles.lock(id, pointer),
      unlock: (id, pointer) => operational().profiles.unlock(id, pointer),
    },
    match: {
      scoreForJob: (input) => operational().matches.runForJob(input),
      list: (input) => operational().matches.list(input),
      show: (id) => operational().matches.show(id),
      wait: (taskId, signal) => operational().wait.wait(parseId(taskId, 'Task'), signal),
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
      database?.close();
      return Promise.resolve();
    },
  };
}
export function createMinimalCliContainer(): CliContainer {
  return {
    version: { get: () => ({ app: '0.1.0', node: process.versions.node }) },
    close: () => Promise.resolve(),
  };
}
