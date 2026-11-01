import { describe, expect, it } from 'vitest';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import {
  decideExplicitClosure,
  decideJobMerge,
  decideMissingTransition,
  decideObservedTransition,
  normalizedJobContentHash,
  parseNormalizedJob,
  revisionNumber,
  type NormalizedJob,
} from '../src/domain/index.js';
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

/** 构造测试输入或执行断言的辅助逻辑。 */
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
