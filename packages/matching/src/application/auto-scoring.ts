import type { Clock, IdGenerator } from '@jobhunter/common/domain';
import type { TaskService } from '@jobhunter/common/tasks';
import type { CandidateProfileReader } from '@jobhunter/user/contracts';
import type { MatchingRepository } from '../ports/matching.js';
import {
  MatchProfileNotFoundError,
  MatchResultNotFoundError,
  MatchWorkflowService,
} from './match-workflow-service.js';

/** 同步后自动评分回调的输入；与 recruitment 的 SyncCompletedCallback 结构一致。 */
export interface AutoScoringSyncCompletedInput {
  readonly status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
  readonly scorableJobIds: readonly string[];
}

/** 读取自动匹配设置（WEB-016）的端口，由入口用系统设置服务实现。 */
export interface MatchingAutomationReader {
  readMatchingAutomation(): { readonly scoreEnabled: boolean; readonly adviceEnabled: boolean };
}

/**
 * 创建同步提交后的自动评分回调。
 * 仅处理本运行新增/修订的职位修订；画像缺失或职位已关闭时跳过该职位而不中断其余入队。
 * 模式按设置区分：仅评分=rules，评分+建议=llm。
 */
export function createAutoScoringOnSyncCompleted(input: {
  readonly matching: MatchingRepository;
  readonly profiles: CandidateProfileReader;
  readonly tasks: TaskService;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly automation: MatchingAutomationReader;
}): (completed: AutoScoringSyncCompletedInput) => void {
  const workflow = new MatchWorkflowService({
    matching: input.matching,
    profiles: input.profiles,
    tasks: input.tasks,
    ids: input.ids,
  });
  return ({ status, scorableJobIds }) => {
    // 失败或取消的运行不派生评分任务，避免在不可靠数据上放大写入。
    if (status !== 'succeeded' && status !== 'partial') return;
    const automation = input.automation.readMatchingAutomation();
    if (!automation.scoreEnabled) return;
    if (scorableJobIds.length === 0) return;
    const mode = automation.adviceEnabled ? 'llm' : 'rules';
    for (const jobId of scorableJobIds) {
      try {
        workflow.runForJob({
          jobId,
          mode,
          idempotencyToken: input.ids.generate(),
        });
      } catch (error) {
        // 无当前画像时整体无可评分对象；单个职位无可用修订或已关闭时跳过该职位。
        if (error instanceof MatchProfileNotFoundError) return;
        if (error instanceof MatchResultNotFoundError || error instanceof TypeError) continue;
        throw error;
      }
    }
  };
}
