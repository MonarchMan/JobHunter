import { canonicalJson, DomainError, type ContentHash, type JobId } from '../shared/index.js';
import {
  normalizedJobContentHash,
  sourceJobIdentity,
  type NormalizedJob,
  type SourceJobIdentity,
} from './normalized-job.js';

declare const revisionNumberBrand: unique symbol;
export type RevisionNumber = number & { readonly [revisionNumberBrand]: true };

export function revisionNumber(value: number): RevisionNumber {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Revision number must be a positive integer.');
  }
  return value as RevisionNumber;
}

export interface CurrentJobRevision {
  readonly jobId: JobId;
  readonly identity: SourceJobIdentity;
  readonly revisionNumber: RevisionNumber;
  readonly contentHash: ContentHash;
  readonly normalized: NormalizedJob;
}

export interface ChangedField {
  readonly field: keyof NormalizedJob;
  readonly before: unknown;
  readonly after: unknown;
}

export type JobMergeDecision =
  | {
      readonly type: 'create';
      readonly identity: SourceJobIdentity;
      readonly contentHash: ContentHash;
      readonly normalized: NormalizedJob;
      readonly revisionNumber: RevisionNumber;
    }
  | {
      readonly type: 'unchanged';
      readonly jobId: JobId;
      readonly contentHash: ContentHash;
    }
  | {
      readonly type: 'revise';
      readonly jobId: JobId;
      readonly contentHash: ContentHash;
      readonly normalized: NormalizedJob;
      readonly revisionNumber: RevisionNumber;
      readonly changes: readonly ChangedField[];
    };

function changesBetween(previous: NormalizedJob, incoming: NormalizedJob): ChangedField[] {
  const changes: ChangedField[] = [];
  for (const field of Object.keys(incoming) as (keyof NormalizedJob)[]) {
    if (canonicalJson(previous[field]) !== canonicalJson(incoming[field])) {
      changes.push({ field, before: previous[field], after: incoming[field] });
    }
  }
  return changes;
}

export function decideJobMerge(
  current: CurrentJobRevision | null,
  incoming: NormalizedJob,
): JobMergeDecision {
  const incomingHash = normalizedJobContentHash(incoming);
  if (!current) {
    return {
      type: 'create',
      identity: sourceJobIdentity(incoming),
      contentHash: incomingHash,
      normalized: incoming,
      revisionNumber: revisionNumber(1),
    };
  }

  if (
    current.identity.sourceId !== incoming.sourceId ||
    current.identity.externalJobId !== incoming.externalJobId
  ) {
    throw new DomainError(
      'JOB_IDENTITY_CONFLICT',
      'Incoming job identity differs from the current job.',
      {
        jobId: current.jobId,
      },
    );
  }

  if (current.contentHash === incomingHash) {
    return { type: 'unchanged', jobId: current.jobId, contentHash: incomingHash };
  }

  return {
    type: 'revise',
    jobId: current.jobId,
    contentHash: incomingHash,
    normalized: incoming,
    revisionNumber: revisionNumber(current.revisionNumber + 1),
    changes: changesBetween(current.normalized, incoming),
  };
}
