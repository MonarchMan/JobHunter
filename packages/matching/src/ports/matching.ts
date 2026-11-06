import type {
  CandidateProfileId,
  CompanyId,
  ContentHash,
  JobEnrichmentId,
  JobId,
  JobRevisionId,
  MatchResultId,
  MatchAdviceId,
  MatchRulesetId,
  ProfileVersionId,
  UtcInstant,
} from '@jobhunter/common/domain';
import type { JobStatus, NormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import type { DeterministicMatchOutput, MatchingCompanyContext } from '../model.js';
import type { JobAdvice } from '../contracts/job-advice.js';
import type { JobUnderstanding } from '../agents/job-understanding.js';
import type { MatchRuleset } from '../scoring/rulesets.js';

/** 应用层数据结构或端口契约。 */
export interface MatchingJobRevisionRecord {
  readonly id: JobRevisionId;
  readonly jobId: JobId;
  readonly jobStatus: JobStatus;
  readonly normalized: NormalizedJob;
  readonly createdAt: UtcInstant;
  readonly lastSeenAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface JobEnrichmentRecord {
  readonly id: JobEnrichmentId;
  readonly jobRevisionId: JobRevisionId;
  readonly agentRunId: string;
  readonly schemaVersion: string;
  readonly contentHash: ContentHash;
  readonly result: JobUnderstanding;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface MatchRulesetRecord {
  readonly id: MatchRulesetId;
  readonly definition: MatchRuleset;
  readonly definitionHash: ContentHash;
  readonly active: boolean;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface MatchResultRecord {
  readonly id: MatchResultId;
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly jobEnrichmentId: JobEnrichmentId | null;
  readonly rulesetId: MatchRulesetId;
  readonly filterStatus: DeterministicMatchOutput['filterStatus'];
  readonly totalScore: number;
  /** 模型阶段拟合分；未配置模型或阶段降级时为 null，总分退回规则口径。 */
  readonly modelScore: number | null;
  readonly components: DeterministicMatchOutput['components'];
  readonly ruleOutcomes: DeterministicMatchOutput['ruleOutcomes'];
  readonly inputHash: ContentHash;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface MatchAdviceRecord {
  /** 建议开始生成时绑定的评分输入，防止评分被覆盖后的旧建议回写。 */
  readonly matchInputHash?: ContentHash;
  readonly id: MatchAdviceId;
  readonly matchResultId: MatchResultId;
  readonly agentRunId: string;
  readonly schemaVersion: string;
  readonly contentHash: ContentHash;
  readonly result: JobAdvice;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface MatchAdviceSelector {
  readonly agentKey: string;
  readonly definitionHash: string;
  readonly modelConfigHash: string;
}

/** 应用层数据结构或端口契约。 */
export interface CurrentMatchListItem {
  readonly match: MatchResultRecord;
  readonly jobId: JobId;
  readonly title: string;
  readonly jobStatus: JobStatus;
  readonly publishedAt: UtcInstant | null;
  readonly lastSeenAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface CurrentMatchQuery {
  readonly profileId: CandidateProfileId;
  readonly includeExcluded?: boolean;
  readonly includeStale?: boolean;
  readonly includeClosed?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

/** 应用层数据结构或端口契约。 */
export interface CurrentMatchPage {
  readonly items: readonly CurrentMatchListItem[];
  readonly nextCursor: string | null;
}

/** 应用层数据结构或端口契约。 */
export interface MatchingRepository {
  getRevision(id: JobRevisionId): MatchingJobRevisionRecord | null;
  getLatestRevisionForJob(jobId: JobId): MatchingJobRevisionRecord | null;
  getCompanyContext(companyId: CompanyId): MatchingCompanyContext;
  getEnrichment(id: JobEnrichmentId): JobEnrichmentRecord | null;
  getLatestEnrichmentForRevision(jobRevisionId: JobRevisionId): JobEnrichmentRecord | null;
  saveEnrichment(record: JobEnrichmentRecord): JobEnrichmentRecord;
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
