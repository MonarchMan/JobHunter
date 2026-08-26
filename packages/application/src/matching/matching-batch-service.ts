import type {
  JobEnrichmentId,
  JobRevisionId,
  MatchRulesetId,
  ProfileVersionId,
} from '@jobhunter/domain';
import type { DeterministicMatchingService } from './matching-service.js';
import type { MatchResultRecord } from '../ports/matching.js';

export interface MatchBatchResult {
  readonly matchResultId: string;
  readonly processedInputs: number;
  readonly createdResults: number;
  readonly existingResults: number;
}

export class MatchingBatchService {
  readonly #calculator: DeterministicMatchingService;
  readonly #onMatch: ((match: MatchResultRecord) => void) | null;

  public constructor(input: {
    readonly calculator: DeterministicMatchingService;
    readonly onMatch?: (match: MatchResultRecord) => void;
  }) {
    this.#calculator = input.calculator;
    this.#onMatch = input.onMatch ?? null;
  }

  public forRevision(input: {
    readonly jobRevisionId: JobRevisionId;
    readonly jobEnrichmentId: JobEnrichmentId | null;
    readonly profileVersionId: ProfileVersionId;
    readonly rulesetId?: MatchRulesetId;
    readonly signal: AbortSignal;
  }): Promise<MatchBatchResult> {
    if (input.signal.aborted) {
      return Promise.reject(new DOMException('Matching batch was cancelled.', 'AbortError'));
    }
    const result = this.#calculator.compute({
      profileVersionId: input.profileVersionId,
      jobRevisionId: input.jobRevisionId,
      jobEnrichmentId: input.jobEnrichmentId,
      ...(input.rulesetId ? { rulesetId: input.rulesetId } : {}),
    });
    this.#onMatch?.(result.match);
    return Promise.resolve({
      matchResultId: result.match.id,
      processedInputs: 1,
      createdResults: result.created ? 1 : 0,
      existingResults: result.created ? 0 : 1,
    });
  }
}
