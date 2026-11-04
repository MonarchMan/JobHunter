import type { TaskRuntimeContext, TaskCapability } from '@jobhunter/common/task-runtime';
import type { MatchingJobReader } from '@jobhunter/recruitment/contracts/matching-jobs';
import type { MatchingRepository } from '@jobhunter/matching/ports/matching';
import type {
  MatchingProfileIdentityReader,
  CandidateProfileReader,
} from '@jobhunter/user/contracts';
import { defaultMatchRulesetId } from '@jobhunter/matching';
import {
  createJobAdviceTaskHandler,
  createJobUnderstandingTaskHandler,
  createMatchRevisionTaskHandler,
  createManualJobScoreTaskHandler,
  createBatchJobScoreTaskHandler,
  DeterministicMatchingService,
  MatchingBatchService,
} from '@jobhunter/matching/application';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { SqliteMatchingRepository } from '@jobhunter/matching/persistence';

/** 匹配任务能力额外暴露已装配的匹配仓储，供入口构造同步后自动评分回调。 */
export interface MatchingTaskCapability extends TaskCapability {
  readonly matchingRepository: MatchingRepository;
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
  deterministicMatching.ensureRulesetV5({ id: defaultMatchRulesetId });
  const batches = new MatchingBatchService({
    calculator: deterministicMatching,
  });
  const matchingHandler = createMatchRevisionTaskHandler(batches);
  registry.register(matchingHandler);
  // 2、模型可选，但所有任务类型始终注册，以提供明确的配置错误。
  const understandingHandler = createJobUnderstandingTaskHandler(
    runner
      ? { runner, matching: matchingRepository, profiles: profileRepository, clock, ids }
      : { unavailable: true },
  );
  const adviceHandler = createJobAdviceTaskHandler(
    runner
      ? { runner, matching: matchingRepository, profiles: profileRepository, clock, ids }
      : { unavailable: true },
  );
  registry.register(understandingHandler);
  registry.register(adviceHandler);
  const singleScoring = createManualJobScoreTaskHandler({
    understanding: understandingHandler,
    matching: matchingHandler,
    advice: adviceHandler,
    adviceEnabled: input.adviceEnabled,
  });
  registry.register(singleScoring);
  registry.register(createBatchJobScoreTaskHandler(singleScoring));
  return { matchingRepository, close: () => Promise.resolve() };
}
