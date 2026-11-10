import { SqliteResumePolishSuggestionStore } from '@jobhunter/user/persistence/resume-polish-suggestion-store';
import { NodeResearchDelivery } from '@jobhunter/user/persistence/research-delivery';
import { AiSessionService } from '../ai/service.js';
import { createAiReplyHandler } from '../ai/handler.js';
import { SqliteAiSessionRepository } from '../persistence/ai-session-repository.js';
import type { TaskRuntimeContext, TaskCapability } from '@jobhunter/common/task-runtime';
import type { ProfileDerivedDataManager } from '../contracts/profile-dependencies.js';
import { SqliteAgentRunCleanup } from '@jobhunter/common/persistence/agent-run-cleanup';
import {
  CandidateProfileService,
  createResumeProfileTaskHandler,
  createResumePolishTaskHandler,
  createResumeDeletionTaskHandler,
  createResumePdfExportTaskHandler,
  createResumeExportCleanupTaskHandler,
  createArtifactPurgeTaskHandler,
  ResumeDeletionService,
} from '@jobhunter/user/profile';
import {
  createExperienceResearchTaskHandler,
  ExperienceResearchService,
} from '@jobhunter/user/interview';
import { SqliteArtifactStore } from '@jobhunter/user/persistence/artifact-store';
import { SqliteCandidateProfileRepository } from '@jobhunter/user/persistence';
import { SqliteInterviewResearchRepository } from '@jobhunter/user/persistence/interview-research-repository';
import { SqliteResumeDocumentRepository } from '@jobhunter/user/persistence/resume-document-repository';
import { SqliteResumeArtifactReader } from '@jobhunter/user/persistence/resume-artifact-reader';
import { SqliteResumeDeletionRepository } from '@jobhunter/user/persistence/resume-deletion-repository';
import { SqliteResumeDraftRepository } from '@jobhunter/user/persistence/resume-draft-repository';
import { TesseractResumeOcrEngine } from '@jobhunter/user/ocr';
import {
  ClaudeCodeResearchExecutor,
  CodexLocalResearchExecutor,
} from './codex-research-executor.js';
import { ConfiguredModelResearchExecutor } from './configured-model-research-executor.js';
import { PlaywrightResumePdfRenderer } from './resume-pdf-renderer.js';

/** 用户任务自行装配简历、OCR、导出和面试能力，派生数据参与者由入口注入。 */
export function createUserTasks(
  context: TaskRuntimeContext,
  input: {
    readonly derivedData: ProfileDerivedDataManager;
  },
): TaskCapability {
  // 1、共用同连接与时钟，确保删除参与者的事务边界保持不变。
  const {
    database,
    dataRoot,
    ids,
    clock,
    registry,
    runner: configuredRunner,
    tasks: interviewTasks,
    schedules: scheduleService,
  } = context;
  const profileRepository = new SqliteCandidateProfileRepository(
    database.client,
    input.derivedData,
  );
  const interviewResearchRepository = new SqliteInterviewResearchRepository(database.client);
  const interviewArtifacts = new SqliteArtifactStore(database.client, dataRoot);
  registry.register(
    createExperienceResearchTaskHandler({
      repository: interviewResearchRepository,
      service: new ExperienceResearchService({
        delivery: new NodeResearchDelivery(dataRoot),
        repository: interviewResearchRepository,
        artifacts: interviewArtifacts,
        clock,
        ids,
      }),
      executors: [
        ...(configuredRunner ? [new ConfiguredModelResearchExecutor(configuredRunner)] : []),
        new CodexLocalResearchExecutor(),
        new ClaudeCodeResearchExecutor(),
      ],
    }),
  );
  const resumeDeletion = new ResumeDeletionService({
    repository: new SqliteResumeDeletionRepository(
      database.client,
      input.derivedData,
      new SqliteAgentRunCleanup(database.client),
    ),
    artifacts: new SqliteArtifactStore(database.client, dataRoot),
    clock,
  });
  registry.register(createResumeDeletionTaskHandler(resumeDeletion));
  registry.register(createArtifactPurgeTaskHandler(resumeDeletion));
  const resumeDrafts = new SqliteResumeDraftRepository(database.client);
  const resumeExportArtifacts = new SqliteArtifactStore(database.client, dataRoot);
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
  registry.register(
    createAiReplyHandler({
      service: new AiSessionService({
        repository: new SqliteAiSessionRepository(database.client),
        profiles: profileRepository,
        tasks: interviewTasks,
        clock,
        ids,
      }),
      ...(configuredRunner ? { runner: configuredRunner } : {}),
    }),
  );
  const profiles = new CandidateProfileService({ repository: profileRepository, clock, ids });
  // 2、无模型配置仍注册处理器，由处理器给出明确配置错误，不能遗失任务类型。
  registry.register(
    createResumeProfileTaskHandler({
      ...(configuredRunner ? { runner: configuredRunner } : {}),
      documents: new SqliteResumeDocumentRepository(database.client),
      profiles,
      ocr: {
        engine: new TesseractResumeOcrEngine({ dataRoot }),
        artifacts: new SqliteResumeArtifactReader(database.client, dataRoot),
      },
    }),
  );
  registry.register(
    createResumePolishTaskHandler(
      configuredRunner
        ? {
            runner: configuredRunner,
            profiles: profileRepository,
            suggestions: new SqliteResumePolishSuggestionStore(database.client),
          }
        : { unavailable: true },
    ),
  );
  return {
    initialize() {
      // 3、保持原有计划身份与错峰时间，重启不生成重复计划。
      scheduleService.upsert({
        id: ids.generate(),
        // 每天错峰清理过期导出，旧计划身份和历史任务关联继续保留。
        scheduleKey: 'resume-export-cleanup-hourly',
        taskType: 'resume.export.cleanup@v1',
        payload: {},
        cronExpression: '15 4 * * *',
        timezone: 'Asia/Shanghai',
      });
    },
    close: () => Promise.resolve(),
  };
}
