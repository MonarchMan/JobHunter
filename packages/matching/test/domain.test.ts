import { contentHash, parseId } from '@jobhunter/common/domain';
import { describe, expect, it } from 'vitest';
import { buildMatchAdviceIdentity, buildMatchIdentity } from '../src/domain/index.js';

const ids = {
  revision: '018f0000-0000-7000-8000-000000000004',
  profileVersion: '018f0000-0000-7000-8000-000000000005',
  enrichment: '018f0000-0000-7000-8000-000000000006',
  ruleset: '018f0000-0000-7000-8000-000000000007',
  match: '018f0000-0000-7000-8000-000000000008',
  agentRun: '018f0000-0000-7000-8000-000000000009',
} as const;

describe('match identity', () => {
  const common = {
    profileVersionId: parseId(ids.profileVersion, 'ProfileVersion'),
    jobRevisionId: parseId(ids.revision, 'JobRevision'),
    rulesetId: parseId(ids.ruleset, 'MatchRuleset'),
    rulesetHash: contentHash({ conditionWeight: 'equal' }),
    modelUsed: false,
  };

  it('distinguishes base and enrichment-aware matches', () => {
    const base = buildMatchIdentity({ ...common, usesEnrichment: false });
    const enriched = buildMatchIdentity({
      ...common,
      usesEnrichment: true,
      jobEnrichmentId: parseId(ids.enrichment, 'JobEnrichment'),
    });
    expect(base.jobEnrichmentId).toBeNull();
    expect(base.inputHash).not.toBe(enriched.inputHash);
  });

  it('rejects incomplete enrichment identity and keeps advice identity separate', () => {
    expect(() => buildMatchIdentity({ ...common, usesEnrichment: true })).toThrow(
      /enrichment usage/,
    );
    const advice = buildMatchAdviceIdentity({
      matchResultId: parseId(ids.match, 'MatchResult'),
      agentRunId: parseId(ids.agentRun, 'AgentRun'),
      definitionHash: contentHash({ prompt: 'test' }),
      modelConfigHash: contentHash({ model: 'fake' }),
    });
    expect(advice).toHaveLength(64);
  });
});
