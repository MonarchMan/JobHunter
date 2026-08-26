import {
  CandidateProfileService,
  CleanupService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createCleanupTaskHandler,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createResumeProfileTaskHandler,
  createResumeDeletionTaskHandler,
  createArtifactPurgeTaskHandler,
  createSourceSyncTaskHandler,
  createSourceHealthTaskHandler,
  DeterministicMatchingService,
  HandlerRegistry,
  JobSyncService,
  MatchingBatchService,
  OnlineSourceHealthService,
  RetryPolicy,
  ScheduleService,
  SourceHealthCheckService,
  ProfileJobIntakePolicy,
  ResumeDeletionService,
  WorkerEngine,
  type RandomSource,
  type TaskLogger,
  type WorkerDelay,
  type WorkerEngineOptions,
} from '@jobhunter/application';
import { AgentRunner } from '@jobhunter/agent-core';
import {
  defaultMatchRulesetId,
  openSqliteDatabase,
  SqliteArtifactStore,
  DataRootCleanupFileStore,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteCleanupRepository,
  SqliteMatchingRepository,
  SqliteResumeDocumentRepository,
  SqliteResumeDeletionRepository,
  SqliteSourceHealthWriter,
  SqliteSyncRepository,
  SqliteTaskRepository,
  SqliteUnitOfWork,
} from '@jobhunter/db';
import { SystemIdGenerator, utcInstant, type Clock, type IdGenerator } from '@jobhunter/domain';
import { OpenAiCompatibleModelClient } from '@jobhunter/llm';
import {
  AdapterRegistry,
  FetchSourceHttpClient,
  type SourcePageClient,
} from '@jobhunter/source-core';
import { registerFirstPartyAdapters } from '@jobhunter/sources';

export { createPlaywrightSourcePageClient } from './browser-source.js';

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

export function createWorkerApplication(input: {
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
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await engine.shutdown();
      database.close();
    },
  };
}

/** Composes the production worker with the real SQLite sync pipeline and first-party adapters. */
export function createProductionWorkerApplication(input: {
  readonly dataRoot: string;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
  readonly logger?: TaskLogger;
  readonly model?: {
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
  const sync = new JobSyncService({
    uow: new SqliteUnitOfWork(database.client),
    registry: adapters,
    artifacts: new SqliteArtifactStore(database.client, input.dataRoot),
    http: new FetchSourceHttpClient(),
    ...(input.pageClient ? { page: input.pageClient } : {}),
    clock,
    ids,
    jobIntakePolicy: new ProfileJobIntakePolicy(profileRepository),
    options: { normalizerVersion: 'normalize-v1' },
  });
  const registry = new HandlerRegistry();
  registry.register(createSourceSyncTaskHandler(sync));
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
        http: new FetchSourceHttpClient(),
        ...(input.pageClient ? { page: input.pageClient } : {}),
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
      model: new OpenAiCompatibleModelClient(input.model),
      createId: () => ids.generate(),
      now: () => clock.now(),
    });
    registry.register(
      createResumeProfileTaskHandler({
        runner,
        documents: new SqliteResumeDocumentRepository(database.client),
        profiles,
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
  } else {
    registry.register(createResumeProfileTaskHandler({ unavailable: true }));
    understandingHandler = createJobUnderstandingTaskHandler({ unavailable: true });
    adviceHandler = createJobAdviceTaskHandler({ unavailable: true });
    registry.register(understandingHandler);
    registry.register(adviceHandler);
  }
  registry.register(
    createManualJobScoreTaskHandler({
      understanding: understandingHandler,
      matching: matchingHandler,
      advice: adviceHandler,
    }),
  );
  const queue = new SqliteTaskRepository(database.client);
  const scheduleService = new ScheduleService({ queue, clock, ids }, registry);
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
      taskTypeConcurrency: input.taskTypeConcurrency ?? {},
    },
    ...(input.logger ? { logger: input.logger } : {}),
  });
  let closed = false;
  return {
    engine,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await engine.shutdown();
      database.close();
    },
  };
}

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
export const packageId = '@jobhunter/worker' as const;
