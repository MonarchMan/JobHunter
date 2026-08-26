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

function nonEmptyToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token) return undefined;
  return token;
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

  public runForJob(input: {
    readonly jobId: string;
    readonly profileVersionId?: string;
    readonly idempotencyToken?: string;
    readonly mode?: 'rules' | 'llm';
  }): EnqueueTaskResult {
    const jobId = parseId(input.jobId, 'Job');
    const profile = input.profileVersionId
      ? this.#profiles.getVersion(parseId(input.profileVersionId, 'ProfileVersion'))
      : this.#currentProfileVersion();
    if (!profile) throw new MatchProfileNotFoundError(input.profileVersionId ?? 'current');
    const revision = this.#matching.getLatestRevisionForJob(jobId);
    if (!revision) throw new MatchResultNotFoundError(input.jobId);
    if (revision.jobStatus === 'closed') {
      throw new TypeError('已关闭职位不能创建新的匹配任务。');
    }
    const token = nonEmptyToken(input.idempotencyToken) ?? this.#ids.generate();
    return this.#tasks.enqueue({
      taskType: 'match.score-job',
      priority: 100,
      payload: {
        jobRevisionId: revision.id,
        profileVersionId: profile.id,
        mode: input.mode ?? 'rules',
      },
      idempotencyKey: `match.score-job:${input.mode ?? 'rules'}:${jobId}:${profile.id}:${token}`,
    });
  }

  public runForJobs(input: {
    readonly jobIds: readonly string[];
    readonly profileVersionId?: string;
    readonly idempotencyToken?: string;
    readonly mode: 'rules' | 'llm';
  }): readonly EnqueueTaskResult[] {
    if (input.jobIds.length === 0 || input.jobIds.length > 100) {
      throw new TypeError('一次必须选择 1 到 100 个职位。');
    }
    const uniqueJobIds = [...new Set(input.jobIds)];
    const batchToken = nonEmptyToken(input.idempotencyToken) ?? this.#ids.generate();
    return uniqueJobIds.map((jobId) =>
      this.runForJob({
        jobId,
        mode: input.mode,
        ...(input.profileVersionId ? { profileVersionId: input.profileVersionId } : {}),
        idempotencyToken: `${batchToken}:${jobId}`,
      }),
    );
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

  #currentProfileVersion(): ReturnType<CandidateProfileRepository['getCurrentVersion']> {
    const profile = this.#profiles.listProfiles()[0];
    return profile ? this.#profiles.getCurrentVersion(profile.id) : null;
  }
}
