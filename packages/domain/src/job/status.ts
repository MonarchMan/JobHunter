import { DomainError, type UtcInstant } from '../shared/index.js';

type MissingObservationCoverage = 'complete' | 'partial' | 'unknown';

export const JOB_STATUSES = ['active', 'stale', 'closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobStatusReason =
  | 'first_observed'
  | 'missing_threshold_stale'
  | 'missing_threshold_closed'
  | 'explicitly_closed'
  | 'reobserved';

export interface JobLifecycleSnapshot {
  readonly status: JobStatus;
  readonly missingCount: number;
  readonly lastSeenAt: UtcInstant;
  readonly closedAt: UtcInstant | null;
}

export interface JobStatusEventIntent {
  readonly fromStatus: JobStatus | null;
  readonly toStatus: JobStatus;
  readonly reason: JobStatusReason;
  readonly occurredAt: UtcInstant;
}

export interface StatusTransition {
  readonly next: JobLifecycleSnapshot;
  readonly event: JobStatusEventIntent | null;
}

export interface MissingTransitionPolicy {
  readonly staleAfterMisses: number;
  readonly closeAfterMisses: number;
}

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

export function decideMissingTransition(
  current: JobLifecycleSnapshot,
  coverage: MissingObservationCoverage,
  policy: MissingTransitionPolicy,
  at: UtcInstant,
): StatusTransition {
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

export function decideExplicitClosure(
  current: JobLifecycleSnapshot,
  closedAt: UtcInstant,
): StatusTransition {
  return transition(current, 'closed', 'explicitly_closed', closedAt, current.missingCount);
}
