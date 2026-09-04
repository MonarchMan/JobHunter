import {
  CandidateProfileService,
  AsyncSemaphore,
  AsyncSemaphoreCancelledError,
  CleanupService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createCleanupTaskHandler,
  createExperienceResearchTaskHandler,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createProjectAnswerDigestTaskHandler,
  createProjectNotebookTaskHandler,
  createProjectQuestionTaskHandler,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  createResumeDeletionTaskHandler,
  createResumePdfExportTaskHandler,
  createResumeExportCleanupTaskHandler,
  createArtifactPurgeTaskHandler,
  createSourceJobDetailTaskHandler,
  createSourceSyncTaskHandler,
  createSourceHealthTaskHandler,
  DeterministicMatchingService,
  ExperienceResearchService,
  HandlerRegistry,
  JobDetailService,
  JobSyncService,
  MatchingBatchService,
  OnlineSourceHealthService,
  RetryPolicy,
  ScheduleService,
  SourceHealthCheckService,
  SourceScheduleReconciliationService,
  SystemSettingsService,
  TaskService,
  ProfileJobIntakePolicy,
  ResumeDeletionService,
  WorkerEngine,
  type RandomSource,
  type TaskLogger,
  type WorkerDelay,
  type WorkerEngineOptions,
} from '@jobhunter/application';
import { AgentRunner, ModelClientError, type ModelClient } from '@jobhunter/agent-core';
import {
  defaultMatchRulesetId,
  openSqliteDatabase,
  SqliteArtifactStore,
  DataRootCleanupFileStore,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteCleanupRepository,
  SqliteMatchingRepository,
  SqliteInterviewProjectRepository,
  SqliteInterviewResearchRepository,
  SqliteResumeDocumentRepository,
  SqliteResumeArtifactReader,
  SqliteResumeDeletionRepository,
  SqliteResumeDraftRepository,
  SqliteSourceHealthWriter,
  SqliteSourceManagementRepository,
  SqliteSettingsStore,
  SqliteSyncRepository,
  SqliteTaskRepository,
  SqliteUnitOfWork,
} from '@jobhunter/db';
import {
  parseId,
  SystemIdGenerator,
  utcInstant,
  type Clock,
  type IdGenerator,
} from '@jobhunter/domain';
import { createConfiguredModelClient } from '@jobhunter/llm';
import { TesseractResumeOcrEngine } from '@jobhunter/resume';
import {
  AdapterRegistry,
  FetchSourceHttpClient,
  SourceError,
  TokenBucketSourceRateLimitGate,
  type SourceHttpClient,
  type SourcePageClient,
  type SourceRateLimitGate,
} from '@jobhunter/source-core';
import { firstPartySourceCatalog, registerFirstPartyAdapters } from '@jobhunter/sources';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  BrowserAssistedCodexResearchExecutor,
  CodexLocalResearchExecutor,
} from './codex-research-executor.js';
import { PlaywrightResumePdfRenderer } from './resume-pdf-renderer.js';

export { createPlaywrightSourcePageClient } from './browser-source.js';

/** Worker 运行时数据结构或执行契约。 */
export interface WorkerApplication {
  readonly engine: WorkerEngine;
  close(): Promise<void>;
}

const systemClock: Clock = {
  now: () => utcInstant(Date.now()),
};

const systemRandom: RandomSource = {
  next: () => Math.random(),
};

/** 为来源 HTTP 客户端施加总并发和单来源限流。 */
function limitSourceHttp(
  client: SourceHttpClient,
  semaphore: AsyncSemaphore,
  rateLimit: SourceRateLimitGate,
): SourceHttpClient {
  return {
    async request(request) {
      try {
        await rateLimit.beforeRequest({
          sourceKey: request.sourceKey,
          signal: request.signal,
        });
        return await semaphore.run(request.signal, () => client.request(request));
      } catch (error) {
        if (error instanceof AsyncSemaphoreCancelledError) {
          throw new SourceError('temporary', 'Source request was cancelled while queued.');
        }
        throw error;
      }
    },
  };
}

/** 为来源分页客户端施加页面访问节流。 */
function limitSourcePage(
  client: SourcePageClient,
  semaphore: AsyncSemaphore,
  rateLimit: SourceRateLimitGate,
): SourcePageClient {
  const collect = client.collect;
  return {
    async snapshot(request) {
      try {
        await rateLimit.beforeRequest({
          sourceKey: request.sourceKey,
          signal: request.signal,
        });
        return await semaphore.run(request.signal, () => client.snapshot(request));
      } catch (error) {
        if (error instanceof AsyncSemaphoreCancelledError) {
          throw new SourceError('temporary', 'Browser request was cancelled while queued.');
        }
        throw error;
      }
    },
    ...(collect
      ? {
          async collect(request) {
            try {
              await rateLimit.beforeRequest({
                sourceKey: request.sourceKey,
                signal: request.signal,
              });
              return await semaphore.run(request.signal, () => collect(request));
            } catch (error) {
              if (error instanceof AsyncSemaphoreCancelledError) {
                throw new SourceError(
                  'temporary',
                  'Browser collection was cancelled while queued.',
                );
              }
              throw error;
            }
          },
        }
      : {}),
  };
}

/** 读取内置来源的默认限流配置。 */
function firstPartyRateLimits(): ReadonlyMap<
  string,
  { readonly requestsPerMinute: number; readonly burst: number }
> {
  const policies = new Map<
    string,
    { readonly requestsPerMinute: number; readonly burst: number }
  >();
  for (const channel of firstPartySourceCatalog) {
    for (const source of channel.sources) {
      const current = policies.get(source.adapterKey);
      policies.set(source.adapterKey, {
        requestsPerMinute: Math.min(
          current?.requestsPerMinute ?? Number.POSITIVE_INFINITY,
          source.defaultRateLimit.requestsPerMinute,
        ),
        burst: Math.min(current?.burst ?? Number.POSITIVE_INFINITY, source.defaultRateLimit.burst),
      });
    }
  }
  return policies;
}

/** 用统一信号量限制模型调用并发。 */
function limitModel(client: ModelClient, semaphore: AsyncSemaphore): ModelClient {
  return {
    metadata: client.metadata,
    async complete(request, signal) {
      try {
        return await semaphore.run(signal, () => client.complete(request, signal));
      } catch (error) {
        if (error instanceof AsyncSemaphoreCancelledError) {
          throw new ModelClientError('cancelled', 'Model request was cancelled while queued.');
        }
        throw error;
      }
    },
  };
}

/** 创建测试/开发环境 Worker 依赖并注册任务处理器。 */
export function createWorkerApplication(input: {
  // 1、组装数据库仓储；2、注入来源、模型和浏览器能力；3、注册任务；4、返回 Worker 引用。
  readonly dataRoot: string;
  readonly registry: HandlerRegistry;
  readonly ids: IdGenerator;
  readonly options: WorkerEngineOptions;
  readonly clock?: Clock;
  readonly random?: RandomSource;
  readonly logger?: TaskLogger;
  readonly workerDelay?: WorkerDelay;
}): WorkerApplication {
  const database = openSqliteDatabase({ dataRoot: input.dataRoot });
  const queue = new SqliteTaskRepository(database.client);
  const clock = input.clock ?? systemClock;
  const dependencies = { queue, clock, ids: input.ids };
  const scheduleService = new ScheduleService(dependencies, input.registry);
  const engine = new WorkerEngine({
    queue,
    registry: input.registry,
    clock,
    retryPolicy: new RetryPolicy(input.random ?? systemRandom),
    scheduleService,
    options: input.options,
    ...(input.logger ? { logger: input.logger } : {}),
    ...(input.workerDelay ? { workerDelay: input.workerDelay } : {}),
  });
  let closed = false;
  return {
    engine,
    /** 执行Worker适配器的该项操作。 */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await engine.shutdown();
      database.close();
    },
  };
}

/** Composes the production worker with the real SQLite sync pipeline and first-party adapters. */
/** 创建生产 Worker，加载本机配置并启用受限外部执行器。 */
export function createProductionWorkerApplication(input: {
  readonly dataRoot: string;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly maxConcurrentNetworkTasks?: number;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
  readonly logger?: TaskLogger;
  readonly model?: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
  };
  readonly pageClient?: SourcePageClient;
}): WorkerApplication {
  const database = openSqliteDatabase({ dataRoot: input.dataRoot });
  const ids = new SystemIdGenerator();
  const clock = systemClock;
  const adapters = new AdapterRegistry();
  registerFirstPartyAdapters(adapters);
  const profileRepository = new SqliteCandidateProfileRepository(database.client);
  const uow = new SqliteUnitOfWork(database.client);
  const networkSemaphore = new AsyncSemaphore(input.maxConcurrentNetworkTasks ?? 4);
  const sourceRateLimit = new TokenBucketSourceRateLimitGate(firstPartyRateLimits());
  const sourceHttp = limitSourceHttp(
    new FetchSourceHttpClient(),
    networkSemaphore,
    sourceRateLimit,
  );
  const sourcePage = input.pageClient
    ? limitSourcePage(input.pageClient, networkSemaphore, sourceRateLimit)
    : undefined;
  const eventLoopDelay = input.logger ? monitorEventLoopDelay({ resolution: 20 }) : null;
  eventLoopDelay?.enable();
  const runtimeMetrics = input.logger
    ? setInterval(() => {
        input.logger?.info('worker.runtime', {
          networkActive: networkSemaphore.activeCount,
          networkQueued: networkSemaphore.queuedCount,
          sourceRateLimitQueued: sourceRateLimit.queuedCount(),
          eventLoopDelayP95Ms: Number(
            ((eventLoopDelay?.percentile(95) ?? 0) / 1_000_000).toFixed(2),
          ),
        });
        eventLoopDelay?.reset();
      }, 30_000)
    : null;
  runtimeMetrics?.unref();
  const sync = new JobSyncService({
    uow,
    registry: adapters,
    http: sourceHttp,
    ...(sourcePage ? { page: sourcePage } : {}),
    clock,
    ids,
    jobIntakePolicy: new ProfileJobIntakePolicy(profileRepository),
    options: { normalizerVersion: 'normalize-v1' },
  });
  const registry = new HandlerRegistry();
  const interviewRepository = new SqliteInterviewProjectRepository(database.client);
  const interviewResearchRepository = new SqliteInterviewResearchRepository(database.client);
  const interviewArtifacts = new SqliteArtifactStore(database.client, input.dataRoot);
  registry.register(
    createExperienceResearchTaskHandler({
      repository: interviewResearchRepository,
      service: new ExperienceResearchService({
        repository: interviewResearchRepository,
        artifacts: interviewArtifacts,
        clock,
        ids,
      }),
      executors: [new CodexLocalResearchExecutor(), new BrowserAssistedCodexResearchExecutor()],
    }),
  );
  let interviewTasks: TaskService | null = null;
  const enqueueInterviewNotebook = (dossierId: string): void => {
    const detail = interviewRepository.getDossier(parseId(dossierId, 'ProjectDossier'));
    if (!detail || !interviewTasks) return;
    interviewTasks.enqueue({
      taskType: 'interview.project-notebook.render',
      payload: { dossierId, sourceRevision: detail.dossier.revision },
      idempotencyKey: `interview.project-notebook:${dossierId}:${String(detail.dossier.revision)}`,
    });
  };
  registry.register(
    createProjectNotebookTaskHandler({
      repository: interviewRepository,
      artifacts: interviewArtifacts,
      ids,
    }),
  );
  registry.register(createSourceSyncTaskHandler(sync));
  registry.register(
    createSourceJobDetailTaskHandler(
      new JobDetailService({
        uow,
        registry: adapters,
        http: sourceHttp,
        ...(sourcePage ? { page: sourcePage } : {}),
        clock,
        ids,
        normalizerVersion: 'normalize-v1',
      }),
    ),
  );
  registry.register(
    createCleanupTaskHandler({
      cleanup: new CleanupService({
        repository: new SqliteCleanupRepository(database.client),
        files: new DataRootCleanupFileStore(input.dataRoot),
      }),
    }),
  );
  const resumeDeletion = new ResumeDeletionService({
    repository: new SqliteResumeDeletionRepository(database.client),
    artifacts: new SqliteArtifactStore(database.client, input.dataRoot),
    clock,
  });
  registry.register(createResumeDeletionTaskHandler(resumeDeletion));
  registry.register(createArtifactPurgeTaskHandler(resumeDeletion));
  const resumeDrafts = new SqliteResumeDraftRepository(database.client);
  const resumeExportArtifacts = new SqliteArtifactStore(database.client, input.dataRoot);
  registry.register(
    createResumePdfExportTaskHandler({
      repository: resumeDrafts,
      artifacts: resumeExportArtifacts,
      renderer: new PlaywrightResumePdfRenderer(),
      ids,
    }),
  );
  registry.register(
    createResumeExportCleanupTaskHandler({
      repository: resumeDrafts,
      artifacts: resumeExportArtifacts,
    }),
  );
  const sourceHealth = new SourceHealthCheckService({
    sources: new SqliteSyncRepository(database.client),
    checker: new OnlineSourceHealthService({
      registry: adapters,
      createContext: (source, parsedConfig, signal) => ({
        sourceId: source.id,
        companyId: source.companyId,
        requestId: `health-${String(clock.now())}`,
        config: parsedConfig,
        signal,
        timeoutMs: source.syncPolicy.requestTimeoutMs,
        http: sourceHttp,
        ...(sourcePage ? { page: sourcePage } : {}),
        cursor: source.cursor,
      }),
    }),
    writer: new SqliteSourceHealthWriter(database.client),
  });
  registry.register(createSourceHealthTaskHandler(sourceHealth));
  const matchingRepository = new SqliteMatchingRepository(database.client);
  const deterministicMatching = new DeterministicMatchingService({
    matching: matchingRepository,
    profiles: profileRepository,
    clock,
    ids,
  });
  deterministicMatching.ensureRulesetV1({ id: defaultMatchRulesetId });
  const batches = new MatchingBatchService({
    calculator: deterministicMatching,
  });
  const matchingHandler = createMatchRevisionTaskHandler(batches);
  registry.register(matchingHandler);
  let understandingHandler: ReturnType<typeof createJobUnderstandingTaskHandler>;
  let adviceHandler: ReturnType<typeof createJobAdviceTaskHandler>;
  if (input.model) {
    const profiles = new CandidateProfileService({
      repository: profileRepository,
      clock,
      ids,
    });
    const runner = new AgentRunner({
      store: new SqliteAgentRunStore(database.client),
      model: limitModel(createConfiguredModelClient(input.model), networkSemaphore),
      createId: () => ids.generate(),
      now: () => clock.now(),
    });
    registry.register(
      createResumeProfileTaskHandler({
        runner,
        documents: new SqliteResumeDocumentRepository(database.client),
        profiles,
        ocr: {
          engine: new TesseractResumeOcrEngine({ dataRoot: input.dataRoot }),
          artifacts: new SqliteResumeArtifactReader(database.client, input.dataRoot),
        },
      }),
    );
    registry.register(
      createResumePolishTaskHandler({
        runner,
        profiles: profileRepository,
      }),
    );
    understandingHandler = createJobUnderstandingTaskHandler({
      runner,
      matching: matchingRepository,
      clock,
      ids,
    });
    adviceHandler = createJobAdviceTaskHandler({
      runner,
      matching: matchingRepository,
      profiles: profileRepository,
      clock,
      ids,
    });
    registry.register(understandingHandler);
    registry.register(adviceHandler);
    registry.register(
      createProjectQuestionTaskHandler({
        runner,
        repository: interviewRepository,
        onCommitted: enqueueInterviewNotebook,
      }),
    );
    registry.register(
      createProjectAnswerDigestTaskHandler({
        runner,
        repository: interviewRepository,
        ids,
        onCommitted: enqueueInterviewNotebook,
      }),
    );
  } else {
    registry.register(
      createResumeProfileTaskHandler({
        documents: new SqliteResumeDocumentRepository(database.client),
        profiles: new CandidateProfileService({ repository: profileRepository, clock, ids }),
        ocr: {
          engine: new TesseractResumeOcrEngine({ dataRoot: input.dataRoot }),
          artifacts: new SqliteResumeArtifactReader(database.client, input.dataRoot),
        },
      }),
    );
    registry.register(createResumePolishTaskHandler({ unavailable: true }));
    understandingHandler = createJobUnderstandingTaskHandler({ unavailable: true });
    adviceHandler = createJobAdviceTaskHandler({ unavailable: true });
    registry.register(understandingHandler);
    registry.register(adviceHandler);
    registry.register(createProjectQuestionTaskHandler({ unavailable: true }));
    registry.register(createProjectAnswerDigestTaskHandler({ unavailable: true }));
  }
  registry.register(
    createManualJobScoreTaskHandler({
      understanding: understandingHandler,
      matching: matchingHandler,
      advice: adviceHandler,
    }),
  );
  const queue = new SqliteTaskRepository(database.client);
  interviewTasks = new TaskService({ queue, clock, ids }, registry);
  const scheduleService = new ScheduleService({ queue, clock, ids }, registry);
  scheduleService.upsert({
    id: ids.generate(),
    scheduleKey: 'resume-export-cleanup-hourly',
    taskType: 'resume.export.cleanup@v1',
    payload: {},
    cronExpression: '15 * * * *',
    timezone: 'Asia/Shanghai',
  });
  const settings = new SystemSettingsService({
    repository: new SqliteSettingsStore(database.client),
    clock,
  });
  settings.applySourceSyncChannelSelection();
  new SourceScheduleReconciliationService({
    sources: new SqliteSourceManagementRepository(database.client),
    schedules: scheduleService,
    jobIntakePolicy: new ProfileJobIntakePolicy(profileRepository),
    activeChannel: () => settings.get().sourceSync.channel,
  }).reconcile();
  const engine = new WorkerEngine({
    queue,
    registry,
    clock,
    retryPolicy: new RetryPolicy(systemRandom),
    scheduleService,
    options: {
      workerId: input.workerId ?? `worker-${process.pid.toString()}`,
      emptyPollMinimumMs: input.pollIntervalMs ?? 1_000,
      emptyPollMaximumMs: Math.max(input.pollIntervalMs ?? 1_000, 10_000),
      schedulerPollMs: input.pollIntervalMs ?? 1_000,
      taskTypeConcurrency: {
        ...(input.taskTypeConcurrency ?? {}),
        'interview.project-notebook.render': 1,
        'resume.export.pdf@v1': 1,
      },
    },
    ...(input.logger ? { logger: input.logger } : {}),
  });
  let closed = false;
  return {
    engine,
    /** 执行Worker适配器的该项操作。 */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (runtimeMetrics) clearInterval(runtimeMetrics);
      eventLoopDelay?.disable();
      await engine.shutdown();
      database.close();
    },
  };
}

/** 执行 Worker 任务、浏览器访问或进程管理辅助逻辑。 */
export async function runWorkerProcess(application: WorkerApplication): Promise<void> {
  const abort = new AbortController();
  const requestShutdown = (): void => {
    abort.abort('process_signal');
  };
  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);
  try {
    await application.engine.run(abort.signal);
  } finally {
    process.off('SIGINT', requestShutdown);
    process.off('SIGTERM', requestShutdown);
    await application.close();
  }
}

/** Public package identifier used by composition smoke tests. */
/** Worker 运行时使用的稳定配置或常量。 */
export const packageId = '@jobhunter/worker' as const;
