import { parseId } from '@jobhunter/common/domain';
import {
  classifyTaskError,
  isTaskErrorRetryable,
  TaskExecutionError,
  type TaskHandlerContext,
} from '@jobhunter/common/tasks';
import type {
  SyncScoringProgress,
  SyncScoringStage,
  SyncScoringStageOutcome,
} from '@jobhunter/recruitment/contracts/sync-scoring';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import type { MatchingRepository } from '../ports/matching.js';
import type { createManualJobScoreTaskHandler } from './manual-job-score-handler.js';
import { manualJobScoreTaskPayloadSchema } from './manual-job-score-handler.js';

/** 同步评分阶段成功项的检查点摘要；degraded 记录该次模型分是否缺失（只随本次评分）。 */
interface AutoScoreItemResult {
  readonly matchResultId: string;
  readonly matchAdviceId: string | null;
  readonly degraded: boolean;
  readonly agentRunId: string | null;
}

/** 评分阶段设置读取端口，由入口用系统设置服务实现。 */
export interface SyncScoringSettingsReader {
  readMatchingAutomation(): { readonly scoreEnabled: boolean; readonly adviceEnabled: boolean };
}

/**
 * 创建同步任务评分阶段实现（ADR-0061 的 matching 侧）。
 * 自动路径模型失败降级为规则分（requireModelScore: false）并计入 degraded；
 * 单项失败不中断其余职位；建议开关在每项建议子阶段前读取。
 */
export function createSyncScoringStage(input: {
  readonly matching: MatchingRepository;
  readonly profiles: CandidateProfileReader;
  readonly singleScoring: ReturnType<typeof createManualJobScoreTaskHandler>;
  readonly automation: SyncScoringSettingsReader;
}): SyncScoringStage {
  const run = async (options: {
    readonly context: TaskHandlerContext;
    readonly jobIds: readonly string[];
    readonly previous: SyncScoringProgress | null;
    readonly checkpoint: (progress: SyncScoringProgress) => void;
  }): Promise<SyncScoringStageOutcome> => {
    // 1、评分开关在阶段开始时读取；无当前画像时整个阶段跳过。
    const automation = input.automation.readMatchingAutomation();
    if (!automation.scoreEnabled) return { kind: 'skipped', reason: 'disabled' };
    const profile = input.profiles.listProfiles()[0];
    const profileVersion = profile ? input.profiles.getCurrentVersion(profile.id) : null;
    if (!profileVersion) return { kind: 'skipped', reason: 'no_profile' };

    // 2、逐项串行评分：已成功项跳过，失败项分类后继续，每项经回调落任务检查点。
    const items = new Map(
      (options.previous?.items ?? [])
        .filter((item) => options.jobIds.includes(item.jobId))
        .map((item) => [item.jobId, item]),
    );
    for (const jobId of options.jobIds) {
      if (options.context.signal.aborted) {
        throw new TaskExecutionError('cancelled', '评分阶段已取消。', {
          result: { items: [...items.values()], degraded: degradedCount(items) },
        });
      }
      const previous = items.get(jobId);
      if (previous?.status === 'succeeded') continue;
      const revision = input.matching.getLatestRevisionForJob(parseId(jobId, 'Job'));
      if (!revision || revision.jobStatus === 'closed') {
        items.set(jobId, {
          jobId,
          status: 'failed',
          result: null,
          error: '职位修订不存在或已关闭。',
          errorCategory: 'validation_failed',
          retryable: false,
        });
        options.checkpoint({ items: [...items.values()], degraded: degradedCount(items) });
        continue;
      }
      const base = {
        jobRevisionId: revision.id,
        profileVersionId: profileVersion.id,
        mode: 'llm' as const,
        requireModelScore: false,
      };
      const scoringInput = manualJobScoreTaskPayloadSchema.parse(
        input.singleScoring.retryPayload?.(base, previous?.result) ?? base,
      );
      try {
        const result = await input.singleScoring.execute(options.context, scoringInput);
        items.set(jobId, {
          jobId,
          status: 'succeeded',
          result: {
            matchResultId: result.matchResultId,
            matchAdviceId: result.matchAdviceId,
            degraded: result.modelScoreMissing === true,
            agentRunId: result.agentRunId,
          } satisfies AutoScoreItemResult,
          error: null,
        });
      } catch (error) {
        const classified = classifyTaskError(error);
        // 汇总检查点会丢弃异常链，日志保留脱敏后的根因用于诊断保存等阶段的失败。
        options.context.logger.error('matching.score_item_failed', { jobId, error: classified });
        items.set(jobId, {
          jobId,
          status: 'failed',
          result: classified.result ?? null,
          error: classified.safeSummary,
          errorCategory: classified.category,
          retryable: isTaskErrorRetryable(classified),
        });
      }
      options.checkpoint({ items: [...items.values()], degraded: degradedCount(items) });
    }
    return {
      kind: 'completed',
      progress: { items: [...items.values()], degraded: degradedCount(items) },
    };
  };
  return { run };
}

/** 统计成功项中降级为规则分的数量；恢复项沿用其已保存的降级标记。 */
function degradedCount(
  items: ReadonlyMap<string, { readonly result: unknown; readonly status: string }>,
): number {
  let degraded = 0;
  for (const item of items.values()) {
    if (item.status !== 'succeeded') continue;
    const record = item.result as Partial<AutoScoreItemResult> | null;
    if (record?.degraded === true) degraded += 1;
  }
  return degraded;
}
