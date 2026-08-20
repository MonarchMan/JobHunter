import { parseId, type CandidateProfileId, type IdGenerator } from '@jobhunter/domain';
import type {
  CurrentMatchPage,
  MatchAdviceRecord,
  MatchAdviceSelector,
  MatchingRepository,
  MatchResultRecord,
} from '../ports/matching.js';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import type { EnqueueTaskResult } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';

export class MatchProfileNotFoundError extends Error {
  public constructor(id: string) {
    super(`Candidate profile has no current version: ${id}`);
    this.name = 'MatchProfileNotFoundError';
  }
}

export class MatchResultNotFoundError extends Error {
  public constructor(id: string) {
    super(`Match result not found: ${id}`);
    this.name = 'MatchResultNotFoundError';
  }
}

export interface MatchDetail {
  readonly match: MatchResultRecord;
  readonly job: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly locations: readonly string[];
    readonly detailUrl: string;
    readonly applyUrl: string;
  };
  readonly rulesetVersion: string;
  readonly advice: MatchAdviceRecord | null;
}

export class MatchWorkflowService {
  readonly #matching: MatchingRepository;
  readonly #profiles: CandidateProfileRepository;
  readonly #tasks: TaskService;
  readonly #ids: IdGenerator;
  readonly #adviceSelector: MatchAdviceSelector | null;

  public constructor(input: {
    readonly matching: MatchingRepository;
    readonly profiles: CandidateProfileRepository;
    readonly tasks: TaskService;
    readonly ids: IdGenerator;
    readonly adviceSelector?: MatchAdviceSelector;
  }) {
    this.#matching = input.matching;
    this.#profiles = input.profiles;
    this.#tasks = input.tasks;
    this.#ids = input.ids;
    this.#adviceSelector = input.adviceSelector ?? null;
  }

  public run(profileId: string): EnqueueTaskResult {
    const parsed = this.#profileId(profileId);
    const current = this.#profiles.getCurrentVersion(parsed);
    if (!current) throw new MatchProfileNotFoundError(profileId);
    return this.#tasks.enqueue({
      taskType: 'match.compute-profile',
      payload: { profileVersionId: current.id },
      idempotencyKey: `match.compute-profile:${current.id}:manual:${this.#ids.generate()}`,
    });
  }

  public list(input: {
    readonly profileId: string;
    readonly includeExcluded?: boolean;
    readonly includeStale?: boolean;
    readonly includeClosed?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
  }): CurrentMatchPage {
    const profileId = this.#profileId(input.profileId);
    if (!this.#profiles.getCurrentVersion(profileId)) {
      throw new MatchProfileNotFoundError(input.profileId);
    }
    return this.#matching.listCurrentMatches({
      profileId,
      ...(input.includeExcluded ? { includeExcluded: true } : {}),
      ...(input.includeStale ? { includeStale: true } : {}),
      ...(input.includeClosed ? { includeClosed: true } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  public show(id: string): MatchDetail {
    const matchId = parseId(id, 'MatchResult');
    const match = this.#matching.getMatch(matchId);
    if (!match) throw new MatchResultNotFoundError(id);
    const revision = this.#matching.getRevision(match.jobRevisionId);
    const ruleset = this.#matching.getRuleset(match.rulesetId);
    if (!revision || !ruleset) throw new MatchResultNotFoundError(id);
    return {
      match,
      job: {
        id: revision.jobId,
        title: revision.normalized.title,
        status: revision.jobStatus,
        locations: revision.normalized.locations,
        detailUrl: revision.normalized.detailUrl,
        applyUrl: revision.normalized.applyUrl,
      },
      rulesetVersion: ruleset.version,
      advice: this.#adviceSelector
        ? this.#matching.getCurrentAdvice(matchId, this.#adviceSelector)
        : null,
    };
  }

  #profileId(id: string): CandidateProfileId {
    const profileId = parseId(id, 'CandidateProfile');
    if (!this.#profiles.getProfile(profileId)) throw new MatchProfileNotFoundError(id);
    return profileId;
  }
}
