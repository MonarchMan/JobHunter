import type {
  CandidateProfileId,
  CompanyId,
  ContentHash,
  JobEnrichmentId,
  JobId,
  JobRevisionId,
  JobStatus,
  MatchResultId,
  MatchAdviceId,
  MatchRulesetId,
  NormalizedJob,
  ProfileVersionId,
  UtcInstant,
} from '@jobhunter/domain';
import type {
  DeterministicMatchOutput,
  JobAdvice,
  JobUnderstanding,
  MatchingCompanyContext,
  MatchRuleset,
} from '@jobhunter/matching';

export interface MatchingJobRevisionRecord {
  readonly id: JobRevisionId;
  readonly jobId: JobId;
  readonly jobStatus: JobStatus;
  readonly normalized: NormalizedJob;
  readonly createdAt: UtcInstant;
  readonly lastSeenAt: UtcInstant;
}

export interface JobEnrichmentRecord {
  readonly id: JobEnrichmentId;
  readonly jobRevisionId: JobRevisionId;
  readonly agentRunId: string;
  readonly schemaVersion: string;
  readonly contentHash: ContentHash;
  readonly result: JobUnderstanding;
  readonly createdAt: UtcInstant;
}

export interface MatchRulesetRecord {
  readonly id: MatchRulesetId;
  readonly version: string;
  readonly definition: MatchRuleset;
  readonly definitionHash: ContentHash;
  readonly active: boolean;
  readonly createdAt: UtcInstant;
}

export interface MatchResultRecord {
  readonly id: MatchResultId;
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly jobEnrichmentId: JobEnrichmentId | null;
  readonly rulesetId: MatchRulesetId;
  readonly filterStatus: DeterministicMatchOutput['filterStatus'];
  readonly totalScore: number;
  readonly components: DeterministicMatchOutput['components'];
  readonly ruleOutcomes: DeterministicMatchOutput['ruleOutcomes'];
  readonly inputHash: ContentHash;
  readonly createdAt: UtcInstant;
}

export interface MatchAdviceRecord {
  readonly id: MatchAdviceId;
  readonly matchResultId: MatchResultId;
  readonly agentRunId: string;
  readonly schemaVersion: string;
  readonly contentHash: ContentHash;
  readonly result: JobAdvice;
  readonly createdAt: UtcInstant;
}

export interface MatchAdviceSelector {
  readonly agentKey: string;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly modelConfigHash: string;
}

export interface CurrentMatchListItem {
  readonly match: MatchResultRecord;
  readonly jobId: JobId;
  readonly title: string;
  readonly jobStatus: JobStatus;
  readonly publishedAt: UtcInstant | null;
  readonly lastSeenAt: UtcInstant;
  readonly rulesetVersion: string;
}

export interface CurrentMatchQuery {
  readonly profileId: CandidateProfileId;
  readonly includeExcluded?: boolean;
  readonly includeStale?: boolean;
  readonly includeClosed?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CurrentMatchPage {
  readonly items: readonly CurrentMatchListItem[];
  readonly nextCursor: string | null;
}

export interface MatchingRepository {
  getRevision(id: JobRevisionId): MatchingJobRevisionRecord | null;
  getLatestRevisionForJob(jobId: JobId): MatchingJobRevisionRecord | null;
  getCompanyContext(companyId: CompanyId): MatchingCompanyContext;
  getEnrichment(id: JobEnrichmentId): JobEnrichmentRecord | null;
  getLatestEnrichmentForRevision(jobRevisionId: JobRevisionId): JobEnrichmentRecord | null;
  saveEnrichment(record: JobEnrichmentRecord): JobEnrichmentRecord;
  getRuleset(id: MatchRulesetId): MatchRulesetRecord | null;
  getActiveRuleset(): MatchRulesetRecord | null;
  upsertRuleset(record: MatchRulesetRecord): MatchRulesetRecord;
  createOrGetMatch(record: MatchResultRecord): MatchResultRecord;
  getMatch(id: MatchResultId): MatchResultRecord | null;
  saveAdvice(record: MatchAdviceRecord): MatchAdviceRecord;
  getAdvice(id: MatchAdviceId): MatchAdviceRecord | null;
  getCurrentAdvice(
    matchResultId: MatchResultId,
    selector: MatchAdviceSelector,
  ): MatchAdviceRecord | null;
  listCurrentProfileVersionIdsPage(input: {
    readonly afterId: string | null;
    readonly limit: number;
  }): readonly ProfileVersionId[];
  listLatestRevisionIdsPage(input: {
    readonly afterId: string | null;
    readonly limit: number;
    readonly statuses: readonly JobStatus[];
    readonly targetRoles?: readonly string[];
    readonly excludedTerms?: readonly string[];
  }): readonly JobRevisionId[];
  listCurrentMatches(query: CurrentMatchQuery): CurrentMatchPage;
}
