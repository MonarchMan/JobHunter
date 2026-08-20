import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import type {
  JobEnrichmentId,
  JobRevisionId,
  MatchRulesetId,
  ProfileVersionId,
} from '@jobhunter/domain';
import type { MatchingRepository } from '../ports/matching.js';
import type { DeterministicMatchingService } from './matching-service.js';
import type { MatchResultRecord } from '../ports/matching.js';

export interface MatchBatchResult {
  readonly processedInputs: number;
  readonly createdResults: number;
  readonly existingResults: number;
}

export class MatchingBatchService {
  readonly #matching: MatchingRepository;
  readonly #calculator: DeterministicMatchingService;
  readonly #pageSize: number;
  readonly #onMatch: ((match: MatchResultRecord) => void) | null;

  public constructor(input: {
    readonly matching: MatchingRepository;
    readonly calculator: DeterministicMatchingService;
    readonly pageSize?: number;
    readonly onMatch?: (match: MatchResultRecord) => void;
  }) {
    this.#matching = input.matching;
    this.#calculator = input.calculator;
    this.#pageSize = input.pageSize ?? 100;
    this.#onMatch = input.onMatch ?? null;
    if (!Number.isSafeInteger(this.#pageSize) || this.#pageSize < 1 || this.#pageSize > 500) {
      throw new TypeError('Matching batch page size is invalid.');
    }
  }

  public async forRevision(input: {
    readonly jobRevisionId: JobRevisionId;
    readonly jobEnrichmentId: JobEnrichmentId | null;
    readonly rulesetId?: MatchRulesetId;
    readonly signal: AbortSignal;
  }): Promise<MatchBatchResult> {
    let afterId: string | null = null;
    const counts = { processedInputs: 0, createdResults: 0, existingResults: 0 };
    for (;;) {
      this.#assertNotCancelled(input.signal);
      const page = this.#matching.listCurrentProfileVersionIdsPage({
        afterId,
        limit: this.#pageSize,
      });
      for (const profileVersionId of page) {
        this.#assertNotCancelled(input.signal);
        const result = this.#calculator.compute({
          profileVersionId,
          jobRevisionId: input.jobRevisionId,
          jobEnrichmentId: input.jobEnrichmentId,
          ...(input.rulesetId ? { rulesetId: input.rulesetId } : {}),
        });
        this.#onMatch?.(result.match);
        counts.processedInputs += 1;
        if (result.created) counts.createdResults += 1;
        else counts.existingResults += 1;
      }
      if (page.length < this.#pageSize) return counts;
      afterId = page.at(-1) ?? null;
      await yieldEventLoop(undefined, { signal: input.signal });
    }
  }

  public async forProfile(input: {
    readonly profileVersionId: ProfileVersionId;
    readonly rulesetId?: MatchRulesetId;
    readonly signal: AbortSignal;
  }): Promise<MatchBatchResult> {
    let afterId: string | null = null;
    const counts = { processedInputs: 0, createdResults: 0, existingResults: 0 };
    for (;;) {
      this.#assertNotCancelled(input.signal);
      const page = this.#matching.listLatestRevisionIdsPage({
        afterId,
        limit: this.#pageSize,
        statuses: ['active', 'stale'],
      });
      for (const jobRevisionId of page) {
        this.#assertNotCancelled(input.signal);
        const enrichment = this.#matching.getLatestEnrichmentForRevision(jobRevisionId);
        for (const jobEnrichmentId of [null, enrichment?.id ?? null].filter(
          (value, index, values) => values.indexOf(value) === index,
        )) {
          const result = this.#calculator.compute({
            profileVersionId: input.profileVersionId,
            jobRevisionId,
            jobEnrichmentId,
            ...(input.rulesetId ? { rulesetId: input.rulesetId } : {}),
          });
          this.#onMatch?.(result.match);
          counts.processedInputs += 1;
          if (result.created) counts.createdResults += 1;
          else counts.existingResults += 1;
        }
      }
      if (page.length < this.#pageSize) return counts;
      afterId = page.at(-1) ?? null;
      await yieldEventLoop(undefined, { signal: input.signal });
    }
  }

  #assertNotCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Matching batch was cancelled.', 'AbortError');
  }
}
