import {
  contentHash,
  DomainError,
  type AgentRunId,
  type ContentHash,
  type JobEnrichmentId,
  type JobRevisionId,
  type MatchResultId,
  type MatchRulesetId,
  type ProfileVersionId,
} from '../shared/index.js';

/** 模块数据结构或契约。 */
export interface MatchIdentityInput {
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly rulesetId: MatchRulesetId;
  readonly rulesetVersion: string;
  readonly usesEnrichment: boolean;
  readonly jobEnrichmentId?: JobEnrichmentId | null;
}

/** 模块数据结构或契约。 */
export interface MatchIdentity {
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly jobEnrichmentId: JobEnrichmentId | null;
  readonly rulesetId: MatchRulesetId;
  readonly rulesetVersion: string;
  readonly inputHash: ContentHash;
}

/** 校验增强数据一致性并生成匹配输入身份。 */
export function buildMatchIdentity(input: MatchIdentityInput): MatchIdentity {
  const enrichment = input.jobEnrichmentId ?? null;
  if (input.usesEnrichment !== (enrichment !== null)) {
    throw new DomainError(
      'MATCH_IDENTITY_INCOMPLETE',
      'Match enrichment usage and enrichment ID must agree.',
    );
  }
  if (!input.rulesetVersion.trim()) {
    throw new DomainError('MATCH_IDENTITY_INCOMPLETE', 'Ruleset version is required.');
  }

  return {
    profileVersionId: input.profileVersionId,
    jobRevisionId: input.jobRevisionId,
    jobEnrichmentId: enrichment,
    rulesetId: input.rulesetId,
    rulesetVersion: input.rulesetVersion,
    inputHash: contentHash({
      profileVersionId: input.profileVersionId,
      jobRevisionId: input.jobRevisionId,
      jobEnrichmentId: enrichment ?? 'none',
      rulesetId: input.rulesetId,
      rulesetVersion: input.rulesetVersion,
    }),
  };
}

/** 模块数据结构或契约。 */
export interface MatchAdviceIdentityInput {
  readonly matchResultId: MatchResultId;
  readonly agentRunId: AgentRunId;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly modelConfigHash: ContentHash;
}

/** 计算匹配建议输入的稳定内容哈希。 */
export function buildMatchAdviceIdentity(input: MatchAdviceIdentityInput): ContentHash {
  return contentHash(input);
}

/** 匹配筛选结果状态。 */
export const MATCH_FILTER_STATUSES = ['eligible', 'excluded', 'uncertain'] as const;
export type MatchFilterStatus = (typeof MATCH_FILTER_STATUSES)[number];
