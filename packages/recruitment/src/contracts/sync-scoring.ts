import type { TaskHandlerContext } from '@jobhunter/common/tasks';

/**
 * 单个职位的评分结果记录，随同步任务检查点持久化（ADR-0061）。
 * result 只能包含脱敏的评分摘要或供实现方恢复子阶段的检查点，不得包含敏感内容。
 */
export interface SyncScoringItemRecord {
  readonly jobId: string;
  readonly status: 'succeeded' | 'failed';
  /** 成功项为脱敏评分摘要；失败项为可恢复的子阶段检查点或 null。 */
  readonly result: unknown;
  readonly error: string | null;
}

/** 评分阶段进度；与同步任务检查点及输出中的 scoring 字段同构。 */
export interface SyncScoringProgress {
  readonly items: readonly SyncScoringItemRecord[];
  /** 成功项中因模型不可用或理解最终失败而降级为规则分的数量。 */
  readonly degraded: number;
}

/** 评分阶段结论：跳过（开关关闭或无画像）或完成（含逐项结果）。 */
export type SyncScoringStageOutcome =
  | { readonly kind: 'skipped'; readonly reason: 'disabled' | 'no_profile' }
  | { readonly kind: 'completed'; readonly progress: SyncScoringProgress };

/**
 * 同步任务阶段 B 的自动评分端口，由入口注入、matching 实现（依赖反转）。
 * 在同步写事务提交后于同一任务、同一租约内执行；来源健康不由本阶段决定。
 */
export interface SyncScoringStage {
  run(input: {
    /** 同步任务的处理器上下文；实现方不得直接写任务级检查点。 */
    readonly context: TaskHandlerContext;
    /** 本运行新增/修订的职位 ID（去重、保持发现顺序）。 */
    readonly jobIds: readonly string[];
    /** 崩溃恢复时的既有进度；已成功项必须跳过。 */
    readonly previous: SyncScoringProgress | null;
    /** 每完成一项调用一次，由同步处理器合并进任务检查点落库。 */
    readonly checkpoint: (progress: SyncScoringProgress) => void;
  }): Promise<SyncScoringStageOutcome>;
}
