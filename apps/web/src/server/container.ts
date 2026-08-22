import {
  CandidateProfileService,
  DashboardQueryService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createMatchProfileTaskHandler,
  createMatchRevisionTaskHandler,
  createResumeProfileTaskHandler,
  createResumeDeletionTaskHandler,
  createSourceSyncTaskHandler,
  createSourceHealthTaskHandler,
  HandlerRegistry,
  JobQueryService,
  MatchWorkflowService,
  ProfileInspectionService,
  ProfileManagementService,
  ScheduleService,
  SourceManagementService,
  TaskService,
  WebJobQueryService,
  WebJobDetailService,
  WebProfileService,
  WebResumeDeletionService,
  ResumeDeletionService,
  WebSourceService,
  WebDiagnosticsService,
  type AppConfig,
} from '@jobhunter/application/web';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteCandidateProfileRepository,
  SqliteCompanyLookupRepository,
  SqliteDashboardReadModel,
  SqliteJobQueryRepository,
  SqliteMatchingRepository,
  SqliteSourceManagementRepository,
  SqliteTaskRepository,
  SqliteWebJobTraceRepository,
  SqliteWebSourceRepository,
  SqliteWebDiagnosticsRepository,
  SqliteArtifactStore,
  SqliteResumeDeletionRepository,
} from '@jobhunter/db/web';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import path from 'node:path';
import { loadWebRuntimeConfig } from './config.js';

export interface WebApplicationServices {
  readonly dashboard: DashboardQueryService;
  readonly jobs: JobQueryService;
  readonly webJobs: WebJobQueryService;
  readonly webJobDetails: WebJobDetailService;
  readonly sources: SourceManagementService;
  readonly tasks: TaskService;
  readonly profiles: ProfileManagementService;
  readonly webProfiles: WebProfileService;
  readonly webSources: WebSourceService;
  readonly diagnostics: WebDiagnosticsService;
  readonly resumeDeletion: WebResumeDeletionService;
  readonly matches: MatchWorkflowService;
}

export interface WebApplicationContainer {
  readonly services: WebApplicationServices;
  close(): void;
}

/**
 * Web composition root. Handlers are registered for validation and enqueue/retry only;
 * the Web process never executes background work.
 */
export function createLocalWebContainer(
  config: AppConfig,
  options: { readonly migrationsFolder?: string } = {},
): WebApplicationContainer {
  const database = openSqliteDatabase({
    dataRoot: config.bootstrap.dataRoot.value,
    ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
  });
  try {
    const ids = new SystemIdGenerator();
    const clock = { now: () => utcInstant(Date.now()) };
    const registry = new HandlerRegistry();
    const resumeDeletion = new ResumeDeletionService({
      repository: new SqliteResumeDeletionRepository(database.client),
      artifacts: new SqliteArtifactStore(database.client, config.bootstrap.dataRoot.value),
      clock,
    });
    registry.register(
      createSourceSyncTaskHandler({
        run: () => Promise.reject(new Error('Web process cannot execute source synchronization.')),
      }),
    );
    registry.register(
      createSourceHealthTaskHandler({
        check: () => Promise.reject(new Error('Web process cannot execute health checks.')),
      }),
    );
    registry.register(createResumeProfileTaskHandler({ unavailable: true }));
    registry.register(createResumeDeletionTaskHandler(resumeDeletion));
    registry.register(createJobUnderstandingTaskHandler({ unavailable: true }));
    registry.register(createJobAdviceTaskHandler({ unavailable: true }));
    registry.register(createMatchRevisionTaskHandler(null));
    registry.register(createMatchProfileTaskHandler(null));

    const queue = new SqliteTaskRepository(database.client);
    const tasks = new TaskService({ queue, clock, ids }, registry);
    const profileRepository = new SqliteCandidateProfileRepository(database.client);
    const candidateProfiles = new CandidateProfileService({
      repository: profileRepository,
      clock,
      ids,
    });
    const jobRepository = new SqliteJobQueryRepository(database.client);
    const profileInspection = new ProfileInspectionService({
      profiles: profileRepository,
      agentRuns: new SqliteAgentRunStore(database.client),
    });
    const profiles = new ProfileManagementService({
      profiles: candidateProfiles,
      inspection: profileInspection,
    });
    const jobs = new JobQueryService({
      jobs: jobRepository,
      companies: new SqliteCompanyLookupRepository(database.client),
    });
    const sources = new SourceManagementService({
      sources: new SqliteSourceManagementRepository(database.client),
      tasks,
      ids,
    });
    const services: WebApplicationServices = {
      dashboard: new DashboardQueryService(new SqliteDashboardReadModel(database.client)),
      jobs,
      webJobs: new WebJobQueryService(jobs),
      webJobDetails: new WebJobDetailService({
        jobs,
        trace: new SqliteWebJobTraceRepository(database.client),
      }),
      sources,
      webSources: new WebSourceService({
        repository: new SqliteWebSourceRepository(database.client),
        sources,
        tasks,
        schedules: new ScheduleService({ queue, clock, ids }, registry),
        ids,
      }),
      diagnostics: new WebDiagnosticsService({
        tasks,
        repository: new SqliteWebDiagnosticsRepository(database.client),
      }),
      resumeDeletion: new WebResumeDeletionService({ deletion: resumeDeletion, tasks }),
      tasks,
      profiles,
      webProfiles: new WebProfileService({
        profiles: candidateProfiles,
        inspection: profileInspection,
        management: profiles,
      }),
      matches: new MatchWorkflowService({
        matching: new SqliteMatchingRepository(database.client),
        profiles: profileRepository,
        tasks,
        ids,
      }),
    };
    return {
      services,
      close: () => {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

let sharedContainer: Promise<WebApplicationContainer> | undefined;

/** One SQLite handle per Next.js server process; development reloads may recreate the module. */
export function getWebContainer(): Promise<WebApplicationContainer> {
  const workspaceRoot = process.env.JOBHUNTER_WORKSPACE_ROOT ?? process.cwd();
  sharedContainer ??= loadWebRuntimeConfig({ cwd: workspaceRoot }).then((config) =>
    createLocalWebContainer(config, {
      migrationsFolder: path.join(workspaceRoot, 'packages', 'db', 'migrations'),
    }),
  );
  return sharedContainer;
}
