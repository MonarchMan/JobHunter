import { SqliteResumePolishSuggestionStore } from '@jobhunter/user/persistence/resume-polish-suggestion-store';
import { NodeResearchDelivery } from '@jobhunter/user/persistence/research-delivery';
import { AiSessionService } from '@jobhunter/user/ai/service';
import { createAiReplyHandler } from '@jobhunter/user/ai/handler';
import { SqliteAiSessionRepository } from '@jobhunter/user/persistence/ai-session-repository';
import { UsageService } from '@jobhunter/common/usage';
import { SqliteUsageRepository } from '@jobhunter/common/persistence/usage-repository';
import { ProfilePlatformSearchProvider } from '@jobhunter/matching/profile-platform-search';
import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { SqliteAgentRunCleanup } from '@jobhunter/common/persistence/agent-run-cleanup';
import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteJobScoreReader } from '@jobhunter/matching/persistence/job-score-reader';
import { SqliteJobHistoryReader } from '@jobhunter/recruitment/persistence/job-history-reader';
import { SqliteTaskRelationStatusReader } from '@jobhunter/common/persistence/task-relation-status-reader';
import {
  WebBossService,
  WebPlatformService,
} from '@jobhunter/recruitment/platform-application/web-platforms';
import { PlatformActivityService } from '@jobhunter/recruitment/platform-application/platform-activity';
import { createPlatformTaskHandler } from '@jobhunter/recruitment/platform-application/platforms';
import { createPlatformRetentionTaskHandler } from '@jobhunter/recruitment/platform-application/platform-retention';
import {
  CandidateProfileService,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  createResumeDeletionTaskHandler,
  createResumePdfExportTaskHandler,
  ProfileInspectionService,
  ProfileManagementService,
  ResumeDeletionService,
  ResumeImportService,
  ResumeProfileWorkflow,
  ResumeTemplateService,
} from '@jobhunter/user/profile';
import { WebProfileService } from '@jobhunter/user/profile/web-profile-service';
import { WebResumeDeletionService } from '@jobhunter/user/profile/web-resume-deletion-service';
import { ResumePolishService } from '@jobhunter/user/profile/resume-polish-service';
import { CalendarQueryService } from '@jobhunter/recruitment/calendar/calendar-query-service';
import { WebCalendarQueryService } from '@jobhunter/recruitment/calendar/web-calendar-query-service';
import { ApplicationProgressQueryService } from '@jobhunter/recruitment/applications/application-progress-service';
import { WebApplicationProgressService } from '@jobhunter/recruitment/applications/web-application-progress-service';
import { DashboardQueryService } from './dashboard/query-service.js';
import { createDashboardReadModel } from './dashboard/runtime.js';
import { JobQueryService } from '@jobhunter/recruitment/jobs/job-query-service';
import { WebJobDetailService } from '@jobhunter/matching/application/web-job-detail-service';
import { WebJobQueryService } from '@jobhunter/matching/application/web-job-query-service';
import {
  createJobAnalysis,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createBatchJobScoreTaskHandler,
  MatchWorkflowService,
} from '@jobhunter/matching/application';
import {
  createExperienceResearchTaskHandler,
  ExperienceResearchService,
  InterviewExperienceService,
} from '@jobhunter/user/interview';
import { createSourceHealthTaskHandler } from '@jobhunter/recruitment/sync/source-health-handler';
import { createSourceSyncTaskHandler } from '@jobhunter/recruitment/sync/job-sync-handler';
import { ProfileJobIntakePolicy } from '@jobhunter/matching/profile-job-intake-policy';
import { SourceManagementService } from '@jobhunter/recruitment/source-management-service';
import { SourceScheduleReconciliationService } from '@jobhunter/recruitment/sync/source-schedule-reconciliation-service';
import { WebSourceService } from '@jobhunter/recruitment/sync/web-source-service';
import { WebDiagnosticsService } from '@jobhunter/recruitment/diagnostics/web-diagnostics-service';
import { HandlerRegistry, ScheduleService, TaskService } from '@jobhunter/common/tasks';
import { SystemSettingsService } from '@jobhunter/recruitment/settings';
import { createCleanupTaskHandler } from '@jobhunter/common/operations/cleanup-handler';
import { MailboxSettingsService } from '@jobhunter/recruitment/mail-application';
import { loadRuntimeAppConfig, type AppConfig } from '@jobhunter/common/config/index';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteArtifactStore } from '@jobhunter/user/persistence/artifact-store';
import { SqliteSettingsStore } from '@jobhunter/recruitment/persistence/settings';
import { seedSourceCatalog } from '@jobhunter/recruitment/persistence/source-catalog-seed';
import { NodeResumeFileReader } from '@jobhunter/user/persistence/resume-file-reader';
import {
  SqliteCompanyLookupRepository,
  SqliteJobQueryRepository,
} from '@jobhunter/recruitment/persistence/job-query-repository';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';
import { SqliteWebJobTraceRepository } from '@jobhunter/matching/persistence/web-job-trace-repository';
import { SqliteSourceManagementRepository } from '@jobhunter/recruitment/persistence/source-management-repository';
import { SqliteWebSourceRepository } from '@jobhunter/recruitment/persistence/web-source-repository';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import { SqliteWebDiagnosticsRepository } from '@jobhunter/recruitment/persistence/web-diagnostics-repository';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteResumeDeletionRepository } from '@jobhunter/user/persistence/resume-deletion-repository';
import { SqliteResumeDocumentRepository } from '@jobhunter/user/persistence/resume-document-repository';
import { SqliteResumeDraftRepository } from '@jobhunter/user/persistence/resume-draft-repository';
import { SqliteInterviewExperienceRepository } from '@jobhunter/user/persistence/interview-experience-repository';
import { SqliteInterviewResearchRepository } from '@jobhunter/user/persistence/interview-research-repository';
import { SqliteInterviewTaskRetryCoordinator } from '@jobhunter/user/persistence/interview-task-retry-coordinator';
import { SqliteInterviewTaskPublisher } from '@jobhunter/user/persistence/interview-task-publisher';
import { SqliteRecruitmentMailRepository } from '@jobhunter/recruitment/persistence/sqlite-recruitment-mail-repository';
import { SqlitePlatformActivityRepository } from '@jobhunter/recruitment/persistence/platform-activity-repository';
import { SqlitePlatformRepository } from '@jobhunter/recruitment/persistence/platform-repository';
import { firstPartySourceCatalog } from '@jobhunter/recruitment/catalog-data';
import { SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import {
  EncryptedFileCredentialVault,
  FileMailboxConfigStore,
  MailRuntimeStateStore,
} from '@jobhunter/recruitment/mail-config';
import { mailConnectorMetadata } from '@jobhunter/recruitment/mail-metadata';
import path from 'node:path';
import { createRetryableSingleton } from './retryable-singleton.js';
import { browserFixtureIdentity } from './browser-test-isolation.js';
import {
  ensureConfiguredTaskHost,
  requestTaskService,
  taskHostConfiguration,
} from '@jobhunter/common/task-host-runtime';
import { pathToFileURL } from 'node:url';

/** 模块数据结构或契约。 */
export interface WebApplicationServices {
  readonly platformActivity: PlatformActivityService;
  readonly boss: WebBossService;
  readonly zhilian: WebPlatformService;
  readonly '51job': WebPlatformService;
  readonly liepin: WebPlatformService;
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
  readonly usage: UsageService;
  readonly resumeDeletion: WebResumeDeletionService;
  readonly resumes: ResumeProfileWorkflow;
  readonly resumePolish: ResumePolishService;
  readonly resumeTemplates: ResumeTemplateService;
  readonly matches: MatchWorkflowService;
  readonly settings: SystemSettingsService;
  readonly mailboxes: MailboxSettingsService;
  readonly calendar: WebCalendarQueryService;
  readonly applications: WebApplicationProgressService;
  readonly sourceSchedules: SourceScheduleReconciliationService;
  readonly aiSessions: AiSessionService;
  readonly experiences: InterviewExperienceService;
  readonly research: ExperienceResearchService;
}

/** 模块数据结构或契约。 */
export interface WebApplicationContainer {
  readonly services: WebApplicationServices;
  readonly mailOAuth: {
    readonly gmail: {
      readonly clientId: string;
      readonly clientSecret?: string;
      readonly redirectUri: string;
    } | null;
    readonly microsoftGraph: {
      readonly clientId: string;
      readonly clientSecret?: string;
      readonly redirectUri: string;
      readonly tenant: string;
    } | null;
  };
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
    const mailboxStore = new FileMailboxConfigStore(config.bootstrap.mailboxConfigPath.value);
    const mailboxRuntimeState = new MailRuntimeStateStore(config.bootstrap.dataRoot.value);
    const fixtureIdentity = browserFixtureIdentity(process.env);
    const encryptedCredentialVault = new EncryptedFileCredentialVault({
      filePath: config.bootstrap.mailboxCredentialPath.value,
      keyFilePath: config.bootstrap.mailboxCredentialKeyPath.value,
      ...(config.mail.credentialMasterKey.value
        ? { masterKey: config.mail.credentialMasterKey.value.reveal() }
        : {}),
    });
    const credentialVault =
      fixtureIdentity !== null ? createBrowserFixtureCredentialVault() : encryptedCredentialVault;
    const mailboxes = new MailboxSettingsService({
      configs: mailboxStore,
      credentials: credentialVault,
      runtimeState: mailboxRuntimeState,
      metadata: mailConnectorMetadata,
      createMailboxKey: () => ids.generate().replaceAll('-', '').slice(0, 16).toLowerCase(),
    });
    const registry = new HandlerRegistry();
    registry.register(createAiReplyHandler({}));
    registry.register(
      createPlatformRetentionTaskHandler({
        execute: () => {
          throw new Error('Worker required.');
        },
      }),
    );
    for (const provider of ['boss', 'zhilian', '51job', 'liepin'] as const)
      registry.register(
        createPlatformTaskHandler(provider, {
          execute: () => Promise.reject(new Error('Web process cannot connect to platforms.')),
        }),
      );
    const artifacts = new SqliteArtifactStore(database.client, config.bootstrap.dataRoot.value);
    const recruitmentMailRepository = new SqliteRecruitmentMailRepository(database.client);
    const interviewResearchRepository = new SqliteInterviewResearchRepository(database.client);
    const resumeDeletion = new ResumeDeletionService({
      repository: new SqliteResumeDeletionRepository(
        database.client,
        new SqliteProfileDerivedDataManager(database.client),
        new SqliteAgentRunCleanup(database.client),
      ),
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
    registry.register(createExperienceResearchTaskHandler({ unavailable: true }));
    const matchingHandler = createMatchRevisionTaskHandler(null);
    registry.register(matchingHandler);
    const singleScoring = createManualJobScoreTaskHandler({
      analysis: createJobAnalysis({ unavailable: true }),
      matching: matchingHandler,
      // Web 进程不执行模型任务，开关读取结果不影响实际执行，保持与 Worker 同一装配签名。
      adviceEnabled: () => false,
    });
    registry.register(singleScoring);
    registry.register(createBatchJobScoreTaskHandler(singleScoring));

    const queue = new SqliteTaskRepository(database.client);
    const tasks = new TaskService(
      { queue, clock, ids },
      registry,
      process.env.TASK_HOST_TOKEN
        ? {
            notifyCancellation: (taskId) => {
              void requestTaskService({
                dataRoot: config.bootstrap.dataRoot.value,
                configuration: taskHostConfiguration(config),
                method: 'cancel',
                value: { taskId },
              }).catch(() => undefined);
            },
          }
        : null,
      new SqliteInterviewTaskRetryCoordinator(database.client, queue),
    );
    const interviewTaskPublisher = new SqliteInterviewTaskPublisher({
      client: database.client,
      tasks,

      research: interviewResearchRepository,
    });
    const profileRepository = new SqliteCandidateProfileRepository(
      database.client,
      new SqliteProfileDerivedDataManager(database.client),
    );
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
    const jobRepository = new SqliteJobQueryRepository(
      database.client,
      new SqliteJobScoreReader(database.client),
    );
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
    const sourceSchedules = new SourceScheduleReconciliationService({
      sources: sourceRepository,
      schedules,
      jobIntakePolicy,
      activeChannel: () => settings.get().sourceSync.channel,
      automation: () => settings.get().sourceAutomation,
      overrides: () => settings.sourceScheduleOverrides(),
    });
    sourceSchedules.reconcile();
    const services: WebApplicationServices = {
      boss: new WebBossService(
        new SqlitePlatformRepository(database.client),
        tasks,
        'boss',
        new ProfilePlatformSearchProvider(profileRepository),
      ),
      liepin: new WebPlatformService(
        new SqlitePlatformRepository(database.client, 'liepin'),
        tasks,
        'liepin',
        new ProfilePlatformSearchProvider(profileRepository),
      ),
      '51job': new WebPlatformService(
        new SqlitePlatformRepository(database.client, '51job'),
        tasks,
        '51job',
        new ProfilePlatformSearchProvider(profileRepository),
      ),
      zhilian: new WebPlatformService(
        new SqlitePlatformRepository(database.client, 'zhilian'),
        tasks,
        'zhilian',
        new ProfilePlatformSearchProvider(profileRepository),
      ),
      platformActivity: new PlatformActivityService(
        new SqlitePlatformActivityRepository(database.client),
      ),
      dashboard: new DashboardQueryService(createDashboardReadModel(database.client)),
      jobs,
      webJobs: new WebJobQueryService(jobs),
      webJobDetails: new WebJobDetailService({
        jobs,
        trace: new SqliteWebJobTraceRepository(
          database.client,
          new SqliteJobHistoryReader(database.client),
          profileRepository,
          new SqliteTaskRelationStatusReader(database.client),
        ),
      }),
      sources,
      webSources: new WebSourceService({
        repository: new SqliteWebSourceRepository(database.client),
        sources,
        tasks,
        configureSchedule: (sourceId, value) => {
          settings.setSourceSchedule(sourceId, value);
          sourceSchedules.reconcile();
        },
      }),
      usage: new UsageService(
        new SqliteUsageRepository(database.client),
        Number(process.env.MODEL_USD_TO_CNY_RATE ?? '7.2'),
      ),
      diagnostics: new WebDiagnosticsService({
        tasks,
        repository: new SqliteWebDiagnosticsRepository(database.client),
      }),
      resumeDeletion: new WebResumeDeletionService({ deletion: resumeDeletion, tasks }),
      resumes,
      resumePolish: new ResumePolishService({
        profiles: profileRepository,
        suggestions: new SqliteResumePolishSuggestionStore(database.client),
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
        matching: new SqliteMatchingRepository(
          database.client,
          new SqliteMatchingJobReader(database.client),
          new SqliteProfileIdentityReader(database.client),
          new SqliteAgentRunStore(database.client),
        ),
        profiles: profileRepository,
        tasks,
        ids,
      }),
      settings,
      mailboxes,
      calendar: new WebCalendarQueryService(new CalendarQueryService(recruitmentMailRepository)),
      applications: new WebApplicationProgressService(
        new ApplicationProgressQueryService(recruitmentMailRepository),
      ),
      sourceSchedules,
      aiSessions: new AiSessionService({
        repository: new SqliteAiSessionRepository(database.client),
        profiles: profileRepository,
        tasks,
        clock,
        ids,
      }),
      experiences: new InterviewExperienceService({
        repository: new SqliteInterviewExperienceRepository(database.client),
        artifacts,
        clock,
        ids,
      }),
      research: new ExperienceResearchService({
        delivery: new NodeResearchDelivery(config.bootstrap.dataRoot.value),
        repository: interviewResearchRepository,
        artifacts,
        tasks,
        taskPublisher: interviewTaskPublisher,
        clock,
        ids,
      }),
    };
    const gmailClientId = config.mail.gmail.clientId.value;
    const microsoftClientId = config.mail.microsoftGraph.clientId.value;
    return {
      services,
      mailOAuth: {
        gmail:
          gmailClientId === null
            ? null
            : {
                clientId: gmailClientId,
                ...(config.mail.gmail.clientSecret.value
                  ? { clientSecret: config.mail.gmail.clientSecret.value.reveal() }
                  : {}),
                redirectUri: `${config.mail.webBaseUrl.value}/api/mailboxes/oauth/gmail/callback`,
              },
        microsoftGraph:
          microsoftClientId === null
            ? null
            : {
                clientId: microsoftClientId,
                ...(config.mail.microsoftGraph.clientSecret.value
                  ? { clientSecret: config.mail.microsoftGraph.clientSecret.value.reveal() }
                  : {}),
                redirectUri: `${config.mail.webBaseUrl.value}/api/mailboxes/oauth/microsoft-graph/callback`,
                tenant: config.mail.microsoftGraph.tenant.value,
              },
      },
      close: () => {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

const loadSharedContainer = createRetryableSingleton(async () => {
  const workspaceRoot = process.env.JOBHUNTER_WORKSPACE_ROOT ?? process.cwd();
  const config = await loadRuntimeAppConfig({ workspaceRoot });
  return createLocalWebContainer(config, {
    migrationsFolder: path.join(workspaceRoot, 'packages', 'common', 'migrations', 'legacy'),
  });
});

/** One SQLite handle per Next.js server process; development reloads may recreate the module. */
/** 获取进程级单例 Web 容器，避免每个请求重复打开数据库。 */
export function getWebContainer(): Promise<WebApplicationContainer> {
  return loadSharedContainer();
}

/** 写入口在发布工作前确认中央服务可用；服务崩溃后下一次操作按需恢复，读页面不撤销显式停止。 */
export async function getWebMutationContainer(): Promise<WebApplicationContainer> {
  const container = await getWebContainer();
  // 独立临时浏览器夹具提供合成执行器，不能连接用户模型、邮箱或浏览器会话。
  if (!browserFixtureIdentity(process.env)) {
    if (!process.env.TASK_HOST_TOKEN)
      throw new Error('请通过 Web 启动器运行，页面进程不能创建任务宿主。');
    const workspaceRoot = process.env.JOBHUNTER_WORKSPACE_ROOT ?? process.cwd();
    const config = await loadRuntimeAppConfig({ workspaceRoot });
    await ensureConfiguredTaskHost(config, {
      entry: pathToFileURL(path.join(workspaceRoot, 'apps/web/src/server/task-thread-main.ts')),
    });
  }
  return container;
}

/** 浏览器夹具专用内存凭据库，避免端到端测试访问用户的系统凭据。 */
function createBrowserFixtureCredentialVault(): {
  put(ref: string, values: Readonly<Record<string, string>>): Promise<void>;
  get(ref: string): Promise<Readonly<Record<string, string>>>;
  revoke(ref: string): Promise<void>;
} {
  const values = new Map<string, Readonly<Record<string, string>>>([
    ['os:jobhunter/mail/browser-fixture-qq', { password: 'fixture-authorization-code' }],
  ]);
  return {
    put(ref, credential) {
      values.set(ref, { ...credential });
      return Promise.resolve();
    },
    get(ref) {
      const credential = values.get(ref);
      return credential
        ? Promise.resolve({ ...credential })
        : Promise.reject(new Error('Fixture credential is unavailable.'));
    },
    revoke(ref) {
      values.delete(ref);
      return Promise.resolve();
    },
  };
}
