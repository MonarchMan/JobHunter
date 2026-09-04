import {
  CandidateProfileService,
  DashboardQueryService,
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createProjectAnswerDigestTaskHandler,
  createProjectNotebookTaskHandler,
  createProjectQuestionTaskHandler,
  createExperienceResearchTaskHandler,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  createResumeDeletionTaskHandler,
  createResumePdfExportTaskHandler,
  createSourceSyncTaskHandler,
  createSourceHealthTaskHandler,
  createCleanupTaskHandler,
  HandlerRegistry,
  InterviewProjectService,
  InterviewExperienceService,
  ExperienceResearchService,
  JobQueryService,
  MatchWorkflowService,
  ProfileInspectionService,
  ProfileManagementService,
  ProfileJobIntakePolicy,
  ScheduleService,
  SourceManagementService,
  SourceScheduleReconciliationService,
  SystemSettingsService,
  TaskService,
  WebJobQueryService,
  WebJobDetailService,
  WebProfileService,
  WebResumeDeletionService,
  ResumeDeletionService,
  ResumeImportService,
  ResumeProfileWorkflow,
  ResumePolishService,
  ResumeTemplateService,
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
  SqliteInterviewProjectRepository,
  SqliteInterviewExperienceRepository,
  SqliteInterviewResearchRepository,
  SqliteInterviewTaskRetryCoordinator,
  SqliteInterviewTaskPublisher,
  SqliteProjectNotebookReader,
  SqliteResumeDeletionRepository,
  SqliteResumeDocumentRepository,
  SqliteResumeDraftRepository,
  SqliteSettingsStore,
  seedSourceCatalog,
  NodeResumeFileReader,
} from '@jobhunter/db/web';
import { firstPartySourceCatalog } from '@jobhunter/sources';
import { SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import path from 'node:path';
import { loadWebRuntimeConfig } from './config.js';

/** 模块数据结构或契约。 */
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
  readonly resumes: ResumeProfileWorkflow;
  readonly resumePolish: ResumePolishService;
  readonly resumeTemplates: ResumeTemplateService;
  readonly matches: MatchWorkflowService;
  readonly settings: SystemSettingsService;
  readonly interview: InterviewProjectService;
  readonly experiences: InterviewExperienceService;
  readonly research: ExperienceResearchService;
}

/** 模块数据结构或契约。 */
export interface WebApplicationContainer {
  readonly services: WebApplicationServices;
  close(): void;
}

/**
 * Web composition root. Handlers are registered for validation and enqueue/retry only;
 * the Web process never executes background work.
 */
/** 打开本地数据库并装配 Web 查询和面试准备服务。 */
export function createLocalWebContainer(
  config: AppConfig,
  options: { readonly migrationsFolder?: string } = {},
): WebApplicationContainer {
  const database = openSqliteDatabase({
    dataRoot: config.bootstrap.dataRoot.value,
    ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
  });
  try {
    seedSourceCatalog(database.client, firstPartySourceCatalog);
    const ids = new SystemIdGenerator();
    const clock = { now: () => utcInstant(Date.now()) };
    const settings = new SystemSettingsService({
      repository: new SqliteSettingsStore(database.client),
      clock,
    });
    settings.applySourceSyncChannelSelection();
    const registry = new HandlerRegistry();
    const artifacts = new SqliteArtifactStore(database.client, config.bootstrap.dataRoot.value);
    const interviewRepository = new SqliteInterviewProjectRepository(database.client);
    const interviewResearchRepository = new SqliteInterviewResearchRepository(database.client);
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
    registry.register(createCleanupTaskHandler({ unavailable: true }));
    registry.register(createResumeProfileTaskHandler({ unavailable: true }));
    registry.register(createResumePolishTaskHandler({ unavailable: true }));
    registry.register(createResumePdfExportTaskHandler());
    registry.register(createResumeDeletionTaskHandler(resumeDeletion));
    registry.register(createProjectQuestionTaskHandler({ unavailable: true }));
    registry.register(createProjectAnswerDigestTaskHandler({ unavailable: true }));
    registry.register(createExperienceResearchTaskHandler({ unavailable: true }));
    registry.register(
      createProjectNotebookTaskHandler({ repository: interviewRepository, artifacts, ids }),
    );
    const understandingHandler = createJobUnderstandingTaskHandler({ unavailable: true });
    const adviceHandler = createJobAdviceTaskHandler({ unavailable: true });
    const matchingHandler = createMatchRevisionTaskHandler(null);
    registry.register(understandingHandler);
    registry.register(adviceHandler);
    registry.register(matchingHandler);
    registry.register(
      createManualJobScoreTaskHandler({
        understanding: understandingHandler,
        matching: matchingHandler,
        advice: adviceHandler,
      }),
    );

    const queue = new SqliteTaskRepository(database.client);
    const tasks = new TaskService(
      { queue, clock, ids },
      registry,
      null,
      new SqliteInterviewTaskRetryCoordinator(database.client, queue),
    );
    const interviewTaskPublisher = new SqliteInterviewTaskPublisher({
      client: database.client,
      tasks,
      projects: interviewRepository,
      research: interviewResearchRepository,
    });
    const profileRepository = new SqliteCandidateProfileRepository(database.client);
    const agentRuns = new SqliteAgentRunStore(database.client);
    const candidateProfiles = new CandidateProfileService({
      repository: profileRepository,
      clock,
      ids,
    });
    const resumes = new ResumeProfileWorkflow({
      files: new NodeResumeFileReader(),
      imports: new ResumeImportService({
        artifacts,
        documents: new SqliteResumeDocumentRepository(database.client),
        clock,
        ids,
      }),
      profiles: candidateProfiles,
      tasks,
    });
    const jobRepository = new SqliteJobQueryRepository(database.client);
    const profileInspection = new ProfileInspectionService({
      profiles: profileRepository,
      agentRuns,
    });
    const profiles = new ProfileManagementService({
      profiles: candidateProfiles,
      inspection: profileInspection,
    });
    const jobs = new JobQueryService({
      jobs: jobRepository,
      companies: new SqliteCompanyLookupRepository(database.client),
    });
    const sourceRepository = new SqliteSourceManagementRepository(database.client);
    const jobIntakePolicy = new ProfileJobIntakePolicy(profileRepository);
    const sources = new SourceManagementService({
      sources: sourceRepository,
      tasks,
      ids,
      jobIntakePolicy,
      activeChannel: () => settings.get().sourceSync.channel,
    });
    const schedules = new ScheduleService({ queue, clock, ids }, registry);
    new SourceScheduleReconciliationService({
      sources: sourceRepository,
      schedules,
      jobIntakePolicy,
      activeChannel: () => settings.get().sourceSync.channel,
    }).reconcile();
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
        schedules,
        ids,
      }),
      diagnostics: new WebDiagnosticsService({
        tasks,
        repository: new SqliteWebDiagnosticsRepository(database.client),
      }),
      resumeDeletion: new WebResumeDeletionService({ deletion: resumeDeletion, tasks }),
      resumes,
      resumePolish: new ResumePolishService({
        profiles: profileRepository,
        agentRuns,
        tasks,
        ids,
      }),
      resumeTemplates: new ResumeTemplateService({
        drafts: new SqliteResumeDraftRepository(database.client),
        profiles: profileRepository,
        artifacts,
        tasks,
        clock,
        ids,
      }),
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
      settings,
      interview: new InterviewProjectService({
        profiles: profileRepository,
        repository: interviewRepository,
        tasks,
        taskPublisher: interviewTaskPublisher,
        clock,
        ids,
        artifacts,
        notebooks: new SqliteProjectNotebookReader(
          database.client,
          config.bootstrap.dataRoot.value,
        ),
      }),
      experiences: new InterviewExperienceService({
        repository: new SqliteInterviewExperienceRepository(database.client),
        artifacts,
        clock,
        ids,
      }),
      research: new ExperienceResearchService({
        repository: interviewResearchRepository,
        artifacts,
        tasks,
        taskPublisher: interviewTaskPublisher,
        clock,
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
/** 获取进程级单例 Web 容器，避免每个请求重复打开数据库。 */
export function getWebContainer(): Promise<WebApplicationContainer> {
  const workspaceRoot = process.env.JOBHUNTER_WORKSPACE_ROOT ?? process.cwd();
  sharedContainer ??= loadWebRuntimeConfig({ cwd: workspaceRoot }).then((config) =>
    createLocalWebContainer(config, {
      migrationsFolder: path.join(workspaceRoot, 'packages', 'db', 'migrations'),
    }),
  );
  return sharedContainer;
}
