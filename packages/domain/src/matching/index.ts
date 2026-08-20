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

export interface MatchIdentityInput {
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly rulesetId: MatchRulesetId;
  readonly rulesetVersion: string;
  readonly usesEnrichment: boolean;
  readonly jobEnrichmentId?: JobEnrichmentId | null;
}

export interface MatchIdentity {
  readonly profileVersionId: ProfileVersionId;
  readonly jobRevisionId: JobRevisionId;
  readonly jobEnrichmentId: JobEnrichmentId | null;
  readonly rulesetId: MatchRulesetId;
  readonly rulesetVersion: string;
  readonly inputHash: ContentHash;
}

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

export interface MatchAdviceIdentityInput {
  readonly matchResultId: MatchResultId;
  readonly agentRunId: AgentRunId;
  readonly agentVersion: string;
  readonly promptVersion: string;
  readonly modelConfigHash: ContentHash;
}

export function buildMatchAdviceIdentity(input: MatchAdviceIdentityInput): ContentHash {
  return contentHash(input);
}

export const MATCH_FILTER_STATUSES = ['eligible', 'excluded', 'uncertain'] as const;
export type MatchFilterStatus = (typeof MATCH_FILTER_STATUSES)[number];
