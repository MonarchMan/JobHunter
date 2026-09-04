import { DomainError, type UtcInstant } from '../shared/index.js';

/** 领域模型的类型约束。 */
type MissingObservationCoverage = 'complete' | 'partial' | 'unknown';

/** 职位生命周期状态。 */
export const JOB_STATUSES = ['active', 'stale', 'closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 领域模型的类型约束。 */
export type JobStatusReason =
  | 'first_observed'
  | 'missing_threshold_stale'
  | 'missing_threshold_closed'
  | 'explicitly_closed'
  | 'reobserved';

/** 模块数据结构或契约。 */
export interface JobLifecycleSnapshot {
  readonly status: JobStatus;
  readonly missingCount: number;
  readonly lastSeenAt: UtcInstant;
  readonly closedAt: UtcInstant | null;
}

/** 模块数据结构或契约。 */
export interface JobStatusEventIntent {
  readonly fromStatus: JobStatus | null;
  readonly toStatus: JobStatus;
  readonly reason: JobStatusReason;
  readonly occurredAt: UtcInstant;
}

/** 模块数据结构或契约。 */
export interface StatusTransition {
  readonly next: JobLifecycleSnapshot;
  readonly event: JobStatusEventIntent | null;
}

/** 模块数据结构或契约。 */
export interface MissingTransitionPolicy {
  readonly staleAfterMisses: number;
  readonly closeAfterMisses: number;
}

/** 校验缺失状态推进策略的单调阈值。 */
function validatePolicy(policy: MissingTransitionPolicy): void {
  if (
    !Number.isSafeInteger(policy.staleAfterMisses) ||
    !Number.isSafeInteger(policy.closeAfterMisses) ||
    policy.staleAfterMisses < 1 ||
    policy.closeAfterMisses < policy.staleAfterMisses
  ) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Invalid missing transition thresholds.');
  }
}

/** 创建状态变更快照，并仅在状态实际变化时生成事件意图。 */
function transition(
  current: JobLifecycleSnapshot,
  status: JobStatus,
  reason: JobStatusReason,
  at: UtcInstant,
  missingCount: number,
): StatusTransition {
  return {
    next: {
      ...current,
      status,
      missingCount,
      closedAt: status === 'closed' ? (current.closedAt ?? at) : null,
    },
    event:
      current.status === status
        ? null
        : { fromStatus: current.status, toStatus: status, reason, occurredAt: at },
  };
}

/** 执行领域校验、归一化或合并逻辑。 */
export function decideMissingTransition(
  current: JobLifecycleSnapshot,
  coverage: MissingObservationCoverage,
  policy: MissingTransitionPolicy,
  at: UtcInstant,
): StatusTransition {
  // 1、只对完整覆盖的同步增加缺失次数，再按关闭优先、过期次之判断阈值。
  validatePolicy(policy);
  if (coverage !== 'complete') return { next: current, event: null };

  const missingCount = current.missingCount + 1;
  if (missingCount >= policy.closeAfterMisses) {
    return transition(current, 'closed', 'missing_threshold_closed', at, missingCount);
  }
  if (missingCount >= policy.staleAfterMisses) {
    return transition(current, 'stale', 'missing_threshold_stale', at, missingCount);
  }
  return { next: { ...current, missingCount }, event: null };
}

/** 重新观测到职位时恢复 active 并清零缺失计数。 */
export function decideObservedTransition(
  current: JobLifecycleSnapshot,
  observedAt: UtcInstant,
): StatusTransition {
  return {
    next: { status: 'active', missingCount: 0, lastSeenAt: observedAt, closedAt: null },
    event:
      current.status === 'active'
        ? null
        : {
            fromStatus: current.status,
            toStatus: 'active',
            reason: 'reobserved',
            occurredAt: observedAt,
          },
  };
}

/** 处理来源明确声明关闭的职位。 */
export function decideExplicitClosure(
  current: JobLifecycleSnapshot,
  closedAt: UtcInstant,
): StatusTransition {
  return transition(current, 'closed', 'explicitly_closed', closedAt, current.missingCount);
}
