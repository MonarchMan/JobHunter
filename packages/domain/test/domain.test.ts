import { describe, expect, it } from 'vitest';
import {
  buildMatchAdviceIdentity,
  buildMatchIdentity,
  canonicalJson,
  contentHash,
  decideExplicitClosure,
  decideJobMerge,
  decideMissingTransition,
  decideObservedTransition,
  DomainError,
  mergeProfileVersion,
  normalizedJobContentHash,
  parseCandidateProfile,
  parseId,
  parseNormalizedJob,
  revisionNumber,
  SystemIdGenerator,
  utcInstant,
  type CandidateProfileData,
  type NormalizedJob,
} from '../src/index.js';

const IDS = {
  company: '018f0000-0000-7000-8000-000000000001',
  source: '018f0000-0000-7000-8000-000000000002',
  job: '018f0000-0000-7000-8000-000000000003',
  revision: '018f0000-0000-7000-8000-000000000004',
  profileVersion: '018f0000-0000-7000-8000-000000000005',
  enrichment: '018f0000-0000-7000-8000-000000000006',
  ruleset: '018f0000-0000-7000-8000-000000000007',
  match: '018f0000-0000-7000-8000-000000000008',
  agentRun: '018f0000-0000-7000-8000-000000000009',
} as const;

function normalizedJob(overrides: Record<string, unknown> = {}): NormalizedJob {
  return parseNormalizedJob({
    companyId: IDS.company,
    sourceId: IDS.source,
    externalJobId: 'job-1',
    title: 'Agent 开发工程师',
    department: '大模型平台',
    jobFamily: '研发',
    locations: ['深圳', '北京', '北京'],
    employmentType: '全职',
    experienceText: '3 年以上',
    educationText: '本科',
    description: '负责 Agent 平台开发。\r\n\r\n  建设评测体系。',
    detailUrl: 'https://careers.example.com/jobs/1#detail',
    applyUrl: 'https://careers.example.com/apply/1',
    publishedAt: 1_700_000_000_000,
    ...overrides,
  });
}

function profile(overrides: Record<string, unknown> = {}): CandidateProfileData {
  return parseCandidateProfile({
    targetRoles: ['Agent 开发', '大模型应用'],
    preferences: {
      locations: ['北京'],
      companySizes: ['large'],
      employmentTypes: ['全职'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [
      {
        name: 'TypeScript',
        level: 'proficient',
        evidence: [{ source: 'resume', quote: 'TypeScript 项目经验' }],
      },
    ],
    domains: ['大模型应用'],
    yearsOfExperience: 3,
    managementExperience: false,
    ...overrides,
  });
}

describe('domain primitives', () => {
  it('generates RFC 9562 UUIDv7 IDs with the configured timestamp', () => {
    const timestamp = 1_700_000_000_123;
    const generated = new SystemIdGenerator({
      now: () => timestamp,
      random: () => Uint8Array.from([0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    }).generate();

    expect(parseId(generated, 'Task')).toBe(generated);
    expect(generated.at(14)).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(generated.at(19));
    expect(Number.parseInt(generated.replaceAll('-', '').slice(0, 12), 16)).toBe(timestamp);
  });

  it('validates branded UUIDv7 IDs and stable UTC instants', () => {
    expect(parseId(IDS.job, 'Job')).toBe(IDS.job);
    expect(() => parseId('not-an-id', 'Job')).toThrow(DomainError);
    expect(utcInstant(new Date('2026-01-01T00:00:00.000Z'))).toBe(1_767_225_600_000);
  });

  it('canonicalizes object key order and rejects non-finite values', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(contentHash({ b: 2, a: 1 })).toBe(contentHash({ a: 1, b: 2 }));
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow(DomainError);
  });
});

describe('normalized jobs and revisions', () => {
  it('normalizes whitespace, URLs, locations and semantic hashes', () => {
    const first = normalizedJob();
    const second = normalizedJob({
      title: '  Agent   开发工程师 ',
      locations: ['北京', '深圳'],
      description: '负责 Agent 平台开发。\n\n建设评测体系。',
    });
    expect(first.locations).toEqual(['北京', '深圳']);
    expect(first.detailUrl).not.toContain('#detail');
    expect(normalizedJobContentHash(first)).toBe(normalizedJobContentHash(second));
  });

  it('returns unchanged for a replay and a field diff for changed content', () => {
    const initial = normalizedJob();
    const jobId = parseId(IDS.job, 'Job');
    const current = {
      jobId,
      identity: { sourceId: initial.sourceId, externalJobId: initial.externalJobId },
      revisionNumber: revisionNumber(1),
      contentHash: normalizedJobContentHash(initial),
      normalized: initial,
    };

    expect(decideJobMerge(current, normalizedJob())).toEqual({
      type: 'unchanged',
      jobId,
      contentHash: current.contentHash,
    });
    const revised = decideJobMerge(current, normalizedJob({ title: '高级 Agent 开发工程师' }));
    expect(revised.type).toBe('revise');
    if (revised.type === 'revise') {
      expect(revised.revisionNumber).toBe(2);
      expect(revised.changes.map((change) => change.field)).toEqual(['title']);
    }
  });

  it('rejects source identity conflicts', () => {
    const initial = normalizedJob();
    expect(() =>
      decideJobMerge(
        {
          jobId: parseId(IDS.job, 'Job'),
          identity: { sourceId: initial.sourceId, externalJobId: initial.externalJobId },
          revisionNumber: revisionNumber(1),
          contentHash: normalizedJobContentHash(initial),
          normalized: initial,
        },
        normalizedJob({ externalJobId: 'job-2' }),
      ),
    ).toThrow(/identity differs/);
  });
});

describe('job lifecycle', () => {
  const observedAt = utcInstant(1_700_000_000_000);
  const base = {
    status: 'active' as const,
    missingCount: 0,
    lastSeenAt: observedAt,
    closedAt: null,
  };
  const policy = { staleAfterMisses: 2, closeAfterMisses: 3 };

  it('does not mutate missing state for partial or unknown coverage', () => {
    expect(decideMissingTransition(base, 'partial', policy, utcInstant(1_700_000_001_000))).toEqual(
      {
        next: base,
        event: null,
      },
    );
    expect(decideMissingTransition(base, 'unknown', policy, utcInstant(1_700_000_001_000))).toEqual(
      {
        next: base,
        event: null,
      },
    );
  });

  it('moves active to stale and then closed only at complete-sync thresholds', () => {
    const once = decideMissingTransition(base, 'complete', policy, utcInstant(1_700_000_001_000));
    const stale = decideMissingTransition(
      once.next,
      'complete',
      policy,
      utcInstant(1_700_000_002_000),
    );
    const closed = decideMissingTransition(
      stale.next,
      'complete',
      policy,
      utcInstant(1_700_000_003_000),
    );
    expect(stale.event?.reason).toBe('missing_threshold_stale');
    expect(closed.next.status).toBe('closed');
    expect(closed.event?.reason).toBe('missing_threshold_closed');
  });

  it('reopens observed jobs and supports evidence-backed explicit closure', () => {
    const closed = decideExplicitClosure(base, utcInstant(1_700_000_001_000));
    const reopened = decideObservedTransition(closed.next, utcInstant(1_700_000_002_000));
    expect(reopened.next).toMatchObject({ status: 'active', missingCount: 0, closedAt: null });
    expect(reopened.event?.reason).toBe('reobserved');
  });
});

describe('profile version merge', () => {
  it('preserves parent and child locked paths while updating unlocked fields', () => {
    const previous = profile();
    const extracted = profile({
      targetRoles: ['大模型算法'],
      preferences: { ...previous.preferences, locations: ['上海'] },
      yearsOfExperience: 4,
    });
    const merged = mergeProfileVersion(previous, extracted, ['/preferences/locations']);
    expect(merged.effective.preferences.locations).toEqual(['北京']);
    expect(merged.effective.targetRoles).toEqual(['大模型算法']);
    expect(merged.effective.yearsOfExperience).toBe(4);

    const parentLocked = mergeProfileVersion(previous, extracted, ['/preferences']);
    expect(parentLocked.effective.preferences).toEqual(previous.preferences);
  });

  it('reports missing lock paths without corrupting the extracted profile', () => {
    const merged = mergeProfileVersion(profile(), profile(), ['/preferences/not-present']);
    expect(merged.ignoredLockedPaths).toEqual(['/preferences/not-present']);
    expect(merged.effective).toEqual(profile());
  });
});

describe('match identity', () => {
  const common = {
    profileVersionId: parseId(IDS.profileVersion, 'ProfileVersion'),
    jobRevisionId: parseId(IDS.revision, 'JobRevision'),
    rulesetId: parseId(IDS.ruleset, 'MatchRuleset'),
    rulesetVersion: 'v1',
  };

  it('distinguishes base and enrichment-aware matches', () => {
    const base = buildMatchIdentity({ ...common, usesEnrichment: false });
    const enriched = buildMatchIdentity({
      ...common,
      usesEnrichment: true,
      jobEnrichmentId: parseId(IDS.enrichment, 'JobEnrichment'),
    });
    expect(base.jobEnrichmentId).toBeNull();
    expect(base.inputHash).not.toBe(enriched.inputHash);
  });

  it('rejects incomplete enrichment identity and keeps advice identity separate', () => {
    expect(() => buildMatchIdentity({ ...common, usesEnrichment: true })).toThrow(
      /enrichment usage/,
    );
    const advice = buildMatchAdviceIdentity({
      matchResultId: parseId(IDS.match, 'MatchResult'),
      agentRunId: parseId(IDS.agentRun, 'AgentRun'),
      agentVersion: '1',
      promptVersion: '1',
      modelConfigHash: contentHash({ model: 'fake' }),
    });
    expect(advice).toHaveLength(64);
  });
});
