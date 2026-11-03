import type { AppConfig } from '@jobhunter/common/config/index';
import { createConfiguredTaskHost } from '@jobhunter/common/task-host';
import { createSourcePageClient } from '@jobhunter/recruitment/tasks/browser-source';
import {
  createTaskRuntime,
  type TaskRuntimeOptions,
  type TaskApplication,
} from '@jobhunter/common/task-runtime';
import { createCleanupTasks } from '@jobhunter/common/task-cleanup';
import { SqliteRuntimeReferenceReader } from '@jobhunter/common/persistence/runtime-reference-reader';
import { createRecruitmentTasks } from '@jobhunter/recruitment/tasks';
import { SqliteRecruitmentCleanupParticipant } from '@jobhunter/recruitment/persistence/cleanup-participant';
import { SqliteMatchingJobReader } from '@jobhunter/recruitment/persistence/matching-job-reader';
import { createUserTasks } from '@jobhunter/user/tasks';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteProfileIdentityReader } from '@jobhunter/user/persistence/profile-identity-reader';
import { SqliteUserResourceReferenceReader } from '@jobhunter/user/persistence/resource-reference-reader';
import { SqliteUserAgentReferenceReader } from '@jobhunter/user/persistence/agent-reference-reader';
import { createMatchingTasks } from '@jobhunter/matching/tasks';
import { createAutoScoringOnSyncCompleted } from '@jobhunter/matching/application';
import { ProfileJobIntakePolicy } from '@jobhunter/matching/profile-job-intake-policy';
import { ProfilePlatformSearchProvider } from '@jobhunter/matching/profile-platform-search';
import { SqliteProfileDerivedDataManager } from '@jobhunter/matching/persistence/profile-derived-data-manager';
import { SqliteMatchingResourceReferenceReader } from '@jobhunter/matching/persistence/resource-reference-reader';
import { SystemSettingsService } from '@jobhunter/recruitment/settings';
import { SqliteSettingsStore } from '@jobhunter/recruitment/persistence/settings';

/** 入口只组合四模块的任务能力，业务实现与通用机制分别由所有者提供。 */
export function createProductionTaskApplication(
  input: TaskRuntimeOptions &
    Partial<
      Pick<
        Parameters<typeof createRecruitmentTasks>[1],
        'mail' | 'pageClient' | 'platformRequestIntervalMs' | 'platformRequestIntervalMsByProvider'
      >
    >,
): TaskApplication {
  // 1、各工厂共用运行时连接，入口显式注入跨模块只读端口与事务参与者。
  return createTaskRuntime(
    {
      ...input,
      taskTypeConcurrency: {
        ...(input.taskTypeConcurrency ?? {}),
        'interview.project-notebook.render': 1,
        'resume.export.pdf@v1': 1,
      },
    },
    [
      (context) => {
        // 先装配匹配能力并取得其仓储，再以回调形式注入同步，遵循 recruitment 不依赖 matching 的边界。
        const client = context.database.client;
        const profiles = new SqliteCandidateProfileRepository(
          client,
          new SqliteProfileDerivedDataManager(client),
        );
        const settings = new SystemSettingsService({
          repository: new SqliteSettingsStore(client),
          clock: context.clock,
        });
        const matching = createMatchingTasks(context, {
          jobs: new SqliteMatchingJobReader(client),
          identities: new SqliteProfileIdentityReader(client),
          profiles,
        });
        const onSyncCompleted = createAutoScoringOnSyncCompleted({
          matching: matching.matchingRepository,
          profiles,
          tasks: context.tasks,
          ids: context.ids,
          clock: context.clock,
          automation: {
            readMatchingAutomation: () => settings.get().matchingAutomation,
          },
        });
        const recruitment = createRecruitmentTasks(context, {
          ...input,
          jobIntakePolicy: new ProfileJobIntakePolicy(profiles),
          searchProvider: new ProfilePlatformSearchProvider(profiles),
          references: [
            new SqliteRuntimeReferenceReader(client),
            new SqliteUserResourceReferenceReader(client),
            new SqliteMatchingResourceReferenceReader(client),
          ],
          onSyncCompleted,
        });
        // 两个能力共用同一运行时；以组合能力对外释放，保持与原有逐一登记一致的关闭顺序。
        return {
          initialize() {
            matching.initialize?.();
            recruitment.initialize?.();
          },
          async close() {
            await recruitment.close();
            await matching.close();
          },
        };
      },
      (context) =>
        createUserTasks(context, {
          derivedData: new SqliteProfileDerivedDataManager(context.database.client),
        }),
      (context) => {
        const client = context.database.client;
        return createCleanupTasks(context, {
          participants: [new SqliteRecruitmentCleanupParticipant(client)],
          references: [
            new SqliteUserAgentReferenceReader(client),
            new SqliteProfileDerivedDataManager(client),
          ],
        });
      },
    ],
  );
}

/** CLI/Web 将业务配置和浏览器资源注入同一套模块工厂。 */
export function createConfiguredTaskApplication(config: AppConfig): TaskApplication {
  // 1、浏览器池属于招聘模块，由宿主负责在任务停止后释放。
  const pageClient = createSourcePageClient();
  try {
    return createConfiguredTaskHost(config, (options) => {
      const application = createProductionTaskApplication({
        ...options,
        pageClient,
        platformRequestIntervalMs: config.platforms.requestIntervalMs.value,
        platformRequestIntervalMsByProvider: config.platforms.requestIntervalMsByProvider.value,
        mail: {
          modelMode: config.mail.classification.modelMode.value,
          mailboxConfigPath: config.bootstrap.mailboxConfigPath.value,
          credentialPath: config.bootstrap.mailboxCredentialPath.value,
          credentialKeyPath: config.bootstrap.mailboxCredentialKeyPath.value,
          ...(config.mail.credentialMasterKey.value
            ? { credentialMasterKey: config.mail.credentialMasterKey.value.reveal() }
            : {}),
        },
      });
      return {
        engine: application.engine,
        async close() {
          // 2、任务停止后归还浏览器会话，最后由公共宿主关闭日志。
          try {
            await application.close();
          } finally {
            await pageClient.close();
          }
        },
      };
    });
  } catch (error) {
    void pageClient.close();
    throw error;
  }
}
