import type { TaskRuntimeContext, TaskCapability } from '@jobhunter/common/task-runtime';
import type { MatchingJobReader } from '@jobhunter/recruitment/contracts/matching-jobs';
import type { SyncScoringStage } from '@jobhunter/recruitment/contracts/sync-scoring';
import type { MatchingRepository } from '@jobhunter/matching/ports/matching';
import type {
  MatchingProfileIdentityReader,
  CandidateProfileReader,
} from '@jobhunter/user/contracts';
import {
  createJobAnalysis,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createBatchJobScoreTaskHandler,
  createSyncScoringStage,
  DeterministicMatchingService,
  MatchingBatchService,
} from '@jobhunter/matching/application';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';

/** 匹配任务能力额外暴露已装配的匹配仓储与同步评分阶段，供入口注入同步任务。 */
export interface MatchingTaskCapability extends TaskCapability {
  readonly matchingRepository: MatchingRepository;
  /** 同步任务阶段 B 的实现；matching 提供，apps 入口注入 recruitment 任务。 */
  readonly syncScoringStage: SyncScoringStage;
}

/** 匹配任务仅通过公开只读端口取得招聘与资料快照。 */
export function createMatchingTasks(
  context: TaskRuntimeContext,
  input: {
    readonly jobs: MatchingJobReader;
    readonly identities: MatchingProfileIdentityReader;
    readonly profiles: CandidateProfileReader;
    /** 求职建议开关；评分任务据此决定是否运行建议阶段。 */
    readonly adviceEnabled: () => boolean;
    /** 自动评分设置读取端口，由入口用系统设置服务实现。 */
    readonly automation: {
      readMatchingAutomation(): { readonly scoreEnabled: boolean; readonly adviceEnabled: boolean };
    };
  },
): MatchingTaskCapability {
  // 1、只装配匹配仓储，招聘和资料的读取实现由入口提供。
  const { database, clock, ids, registry, runner } = context;
  const profileRepository = input.profiles;
  const matchingRepository = new SqliteMatchingRepository(
    database.client,
    input.jobs,
    input.identities,
    new SqliteAgentRunStore(database.client),
  );
  const deterministicMatching = new DeterministicMatchingService({
    matching: matchingRepository,
    profiles: profileRepository,
    clock,
    ids,
  });
  deterministicMatching.ensureRuleset();
  const batches = new MatchingBatchService({
    calculator: deterministicMatching,
  });
  const matchingHandler = createMatchRevisionTaskHandler(batches);
  registry.register(matchingHandler);
  // 2、模型可选，但所有任务类型始终注册，以提供明确的配置错误。
  const analysis = createJobAnalysis(
    runner
      ? { runner, matching: matchingRepository, profiles: profileRepository, clock, ids }
      : { unavailable: true },
  );
  const singleScoring = createManualJobScoreTaskHandler({
    analysis,
    matching: matchingHandler,
    adviceEnabled: input.adviceEnabled,
  });
  registry.register(singleScoring);
  registry.register(createBatchJobScoreTaskHandler(singleScoring));
  // 3、同步评分阶段复用同一单职位处理器；手动任务与自动阶段共享理解/匹配/建议实现。
  const syncScoringStage = createSyncScoringStage({
    matching: matchingRepository,
    profiles: profileRepository,
    singleScoring,
    automation: input.automation,
  });
  return { matchingRepository, syncScoringStage, close: () => Promise.resolve() };
}
