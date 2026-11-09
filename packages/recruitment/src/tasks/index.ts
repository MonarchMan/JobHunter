import type { TaskRuntimeContext, TaskCapability } from '@jobhunter/common/task-runtime';
import type { JobIntakePolicy } from '../contracts/job-intake.js';
import type { PlatformProfileSearchPlanProvider } from '../contracts/profile-search.js';
import type { ResourceReferenceReader } from '@jobhunter/common/resource-references';
import { createPlatformRetentionTaskHandler } from '@jobhunter/recruitment/platform-application/platform-retention';
import {
  BossPlatformService,
  PlatformBrowsingService,
  createPlatformTaskHandler,
  createBossPlatformTaskHandler,
} from '@jobhunter/recruitment/platform-application/platforms';
import type { AsyncSemaphore } from '@jobhunter/common/tasks';
import { AsyncSemaphoreCancelledError } from '@jobhunter/common/tasks';
import { createSourceJobDetailTaskHandler } from '@jobhunter/recruitment/sync/job-detail-handler';
import { createSourceSyncTaskHandler } from '@jobhunter/recruitment/sync/job-sync-handler';
import { createSourceHealthTaskHandler } from '@jobhunter/recruitment/sync/source-health-handler';
import {
  createMailboxSyncTaskHandler,
  MailClassificationService,
  MailSyncService,
  RecruitmentMailClassifier,
} from '@jobhunter/recruitment/mail-application';
import type { MailboxConfig } from '@jobhunter/recruitment/mail-contracts';
import { JobDetailService } from '@jobhunter/recruitment/sync/job-detail-service';
import { JobSyncService } from '@jobhunter/recruitment/sync/job-sync-service';
import type { SyncScoringStage } from '@jobhunter/recruitment/contracts/sync-scoring';
import { OnlineSourceHealthService } from '@jobhunter/recruitment/sync/online-source-health-service';
import { SourceHealthCheckService } from '@jobhunter/recruitment/sync/source-health-service';
import { SourceScheduleReconciliationService } from '@jobhunter/recruitment/sync/source-schedule-reconciliation-service';
import { SystemSettingsService } from '@jobhunter/recruitment/settings';
import { SqlitePlatformRepository } from '@jobhunter/recruitment/persistence/platform-repository';
import { SqlitePlatformRetentionRepository } from '@jobhunter/recruitment/persistence/platform-retention-repository';
import { SqliteSourceHealthWriter } from '@jobhunter/recruitment/persistence/source-health-writer';
import { SqliteSourceManagementRepository } from '@jobhunter/recruitment/persistence/source-management-repository';
import { SqliteSettingsStore } from '@jobhunter/recruitment/persistence/settings';
import { SqliteSyncRepository } from '@jobhunter/recruitment/persistence/sync-repository';
import { SqliteUnitOfWork } from '@jobhunter/recruitment/persistence/unit-of-work';
import {
  SqliteRecruitmentMailRepository,
  createRecruitmentMailSyncRepository,
  createRecruitmentMailProcessingRepository,
  recruitmentMailMessageRefId,
} from '@jobhunter/recruitment/persistence/sqlite-recruitment-mail-repository';
import {
  BossCdpSessionProvider,
  CdpConnectionManager,
  ZhilianCdpSessionProvider,
  Job51CdpSessionProvider,
  LiepinCdpSessionProvider,
} from '@jobhunter/recruitment/platform-connectors';
import {
  AdapterRegistry,
  FetchSourceHttpClient,
  SourceError,
  TokenBucketSourceRateLimitGate,
  type SourceHttpClient,
  type SourcePageClient,
  type SourceRateLimitGate,
} from '@jobhunter/recruitment/source-contracts';
import { firstPartySourceCatalog, registerFirstPartyAdapters } from '@jobhunter/recruitment';
import {
  createMailConnectorRegistry,
  EncryptedFileCredentialVault,
  FileMailboxConfigStore,
  MailRuntimeStateStore,
} from '@jobhunter/recruitment/mail-connectors';
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

/** 招聘任务只消费入口注入的匹配计划与跨模块引用保护。 */
export function createRecruitmentTasks(
  context: TaskRuntimeContext,
  input: {
    readonly pageClient?: SourcePageClient;
    readonly platformRequestIntervalMs?: number;
    readonly platformRequestIntervalMsByProvider?: Readonly<
      Partial<Record<'boss' | 'zhilian' | '51job' | 'liepin', number | undefined>>
    >;
    readonly jobIntakePolicy: JobIntakePolicy;
    readonly searchProvider: PlatformProfileSearchPlanProvider;
    readonly references: readonly ResourceReferenceReader[];
    /** 同步任务评分阶段端口，由入口注入以遵循 recruitment 不依赖 matching 的边界。 */
    readonly syncScoringStage?: SyncScoringStage;
    readonly mail?: {
      readonly modelMode?: 'off' | 'configured';
      readonly mailboxConfigPath: string;
      readonly credentialPath: string;
      readonly credentialKeyPath: string;
      readonly credentialMasterKey?: string;
      readonly defaultTimezone?: string;
    };
  },
): TaskCapability {
  // 1、来源和平台只创建本模块仓储，资料筛选与引用检查由入口注入。
  const { database, ids, clock, registry, networkSemaphore, schedules: scheduleService } = context;
  const adapters = new AdapterRegistry();
  registerFirstPartyAdapters(adapters);
  const settings = new SystemSettingsService({
    repository: new SqliteSettingsStore(database.client),
    clock,
  });
  // 邮箱配置在装配期同步读取一次，供 initialize 同步对账每邮箱每日计划；本地小文件读取与 .env 同理。
  const mailboxConfigStore = input.mail
    ? new FileMailboxConfigStore(input.mail.mailboxConfigPath)
    : null;
  const mailboxConfigSnapshot: readonly MailboxConfig[] = mailboxConfigStore?.listSnapshot() ?? [];
  const uow = new SqliteUnitOfWork(database.client);
  const sourcePolicies = firstPartyRateLimits();
  const localRateLimit = new TokenBucketSourceRateLimitGate(sourcePolicies);
  const sourceRateLimit: SourceRateLimitGate = {
    async beforeRequest(request) {
      const policy = sourcePolicies.get(request.sourceKey);
      if (
        policy &&
        (await context.networkSemaphore.beforeSourceRequest(
          request.sourceKey,
          policy,
          request.signal,
        ))
      )
        return;
      await localRateLimit.beforeRequest(request);
    },
  };
  const sourceHttp = limitSourceHttp(
    new FetchSourceHttpClient(),
    networkSemaphore,
    sourceRateLimit,
  );
  const sourcePage = input.pageClient
    ? limitSourcePage(input.pageClient, networkSemaphore, sourceRateLimit)
    : undefined;
  const sync = new JobSyncService({
    uow,
    registry: adapters,
    http: sourceHttp,
    ...(sourcePage ? { page: sourcePage } : {}),
    clock,
    ids,
    jobIntakePolicy: input.jobIntakePolicy,
    options: {
      normalizerVersion: 'normalize-v1',
    },
  });
  // 1、浏览器传输属于 Worker；平台和关键词只借用隔离的页面租约。
  const cdpConnections = new CdpConnectionManager();
  const boss = new BossPlatformService(
    new BossCdpSessionProvider({
      connections: cdpConnections,
      requestIntervalMs:
        input.platformRequestIntervalMsByProvider?.boss ?? input.platformRequestIntervalMs ?? 0,
    }),
    new SqlitePlatformRepository(database.client),
    Date.now,
    input.searchProvider,
  );
  registry.register(createBossPlatformTaskHandler(boss));
  const zhilian = new PlatformBrowsingService(
    new ZhilianCdpSessionProvider({
      connections: cdpConnections,
      requestIntervalMs:
        input.platformRequestIntervalMsByProvider?.zhilian ?? input.platformRequestIntervalMs ?? 0,
    }),
    new SqlitePlatformRepository(database.client, 'zhilian'),
    Date.now,
    input.searchProvider,
  );
  registry.register(createPlatformTaskHandler('zhilian', zhilian));
  const job51 = new PlatformBrowsingService(
    new Job51CdpSessionProvider({
      connections: cdpConnections,
      requestIntervalMs:
        input.platformRequestIntervalMsByProvider?.['51job'] ??
        input.platformRequestIntervalMs ??
        0,
    }),
    new SqlitePlatformRepository(database.client, '51job'),
    Date.now,
    input.searchProvider,
  );
  registry.register(createPlatformTaskHandler('51job', job51));
  const liepin = new PlatformBrowsingService(
    new LiepinCdpSessionProvider({
      connections: cdpConnections,
      // 1、每个平台优先采用自身配置；缺失时沿用统一间隔，避免连接器隐藏常量。
      requestIntervalMs:
        input.platformRequestIntervalMsByProvider?.liepin ?? input.platformRequestIntervalMs ?? 0,
    }),
    new SqlitePlatformRepository(database.client, 'liepin'),
    Date.now,
    input.searchProvider,
  );
  registry.register(createPlatformTaskHandler('liepin', liepin));
  registry.register(
    createPlatformRetentionTaskHandler(
      new SqlitePlatformRetentionRepository(database.client, input.references),
    ),
  );
  boss.initialize();
  zhilian.initialize();
  job51.initialize();
  liepin.initialize();
  registry.register(
    createSourceSyncTaskHandler(
      sync,
      ...(input.syncScoringStage ? [{ scoringStage: input.syncScoringStage }] : []),
    ),
  );
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
  if (input.mail && mailboxConfigStore) {
    // 1、读取非敏感配置；2、使用加密文件凭据和独立运行状态；3、引用入库后由同步任务第二阶段分类。
    const mailboxConfigs = mailboxConfigStore;
    const mailboxRuntimeState = new MailRuntimeStateStore(context.dataRoot);
    const credentialVault = new EncryptedFileCredentialVault({
      filePath: input.mail.credentialPath,
      keyFilePath: input.mail.credentialKeyPath,
      ...(input.mail.credentialMasterKey ? { masterKey: input.mail.credentialMasterKey } : {}),
    });
    const connectorRegistry = createMailConnectorRegistry((ref) => credentialVault.get(ref));
    const recruitmentRepository = new SqliteRecruitmentMailRepository(database.client);
    const syncRepository = createRecruitmentMailSyncRepository({
      repository: recruitmentRepository,
      now: () => Date.now(),
    });
    const mailSync = new MailSyncService(syncRepository, mailboxRuntimeState);
    const classifier = new RecruitmentMailClassifier({
      // 邮件提取包含结构化修复，单独设置请求时限并复用全局网络并发额度。
      runner: input.mail.modelMode === 'configured' ? context.createRunner(120_000) : null,
      defaultTimezone: input.mail.defaultTimezone ?? 'Asia/Shanghai',
    });
    const connectorFor = (config: MailboxConfig): ReturnType<typeof connectorRegistry.get> =>
      connectorRegistry.get(config.providerKey);
    const mailClassification = new MailClassificationService({
      configs: mailboxConfigs,
      connectorFor,
      classifier,
      repository: createRecruitmentMailProcessingRepository(recruitmentRepository),
      messageRefIdOf: recruitmentMailMessageRefId,
      createId: () => ids.generate(),
    });
    registry.register(
      createMailboxSyncTaskHandler({
        configs: mailboxConfigs,
        connectorFor,
        service: mailSync,
        classification: mailClassification,
      }),
    );
  }
  // 2、所有处理器登记后再协调稳定计划，资源由宿主统一释放。
  return {
    initialize() {
      scheduleService.upsert({
        id: ids.generate(),
        // 保留旧键以原位替换小时计划，避免重启后出现重复清理任务。
        scheduleKey: 'platform-retention-hourly',
        taskType: 'platform.retention',
        payload: { action: 'run' },
        cronExpression: '35 4 * * *',
        timezone: 'Asia/Shanghai',
      });
      if (input.mail) {
        // 旧的全局批次计划原位停用，避免与每邮箱计划并行重复投递。
        scheduleService.upsert({
          id: ids.generate(),
          scheduleKey: 'mailbox-scan-every-five-minutes',
          taskType: 'mailbox.sync@v1',
          payload: {},
          cronExpression: '0 3 * * *',
          timezone: 'Asia/Shanghai',
          enabled: false,
        });
        // 每个启用邮箱一条每日计划；payload 只携带邮箱键，配置禁用即停用对应计划。
        for (const mailbox of mailboxConfigSnapshot.filter((entry) => entry.enabled)) {
          scheduleService.upsert({
            id: ids.generate(),
            scheduleKey: `mailbox.sync:${mailbox.mailboxKey}`,
            taskType: 'mailbox.sync@v1',
            payload: { mailboxKey: mailbox.mailboxKey },
            cronExpression: '0 3 * * *',
            timezone: 'Asia/Shanghai',
          });
        }
      }
      settings.applySourceSyncChannelSelection();
      new SourceScheduleReconciliationService({
        sources: new SqliteSourceManagementRepository(database.client),
        schedules: scheduleService,
        jobIntakePolicy: input.jobIntakePolicy,
        activeChannel: () => settings.get().sourceSync.channel,
        automation: () => settings.get().sourceAutomation,
        overrides: () => settings.sourceScheduleOverrides(),
      }).reconcile();
    },
    async close() {
      // 3、先取消平台初始化，再等待自建浏览器租约释放。
      boss.close();
      zhilian.close();
      job51.close();
      liepin.close();
      await cdpConnections.close();
    },
  };
}
