import { parseCandidateProfile } from '@jobhunter/user/contracts';
import { parseId, utcInstant } from '@jobhunter/common/domain';
import { parseNormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import { describe, expect, it } from 'vitest';
import {
  calculateDeterministicMatch,
  evaluateMatchingGoldenCase,
  filterCurrentRecommendations,
  parseStoredJobAdvice,
  currentMatchRuleset,
  parseJobUnderstanding,
  parseJobAdviceOutput,
  parseMatchRuleset,
  sortMatches,
  type DeterministicMatchInput,
} from '../src/index.js';

const profile = parseCandidateProfile({
  targetRoles: ['Agent 开发'],
  preferences: {
    locations: ['深圳'],
    companySizes: ['large', 'medium'],
    employmentTypes: ['全职'],
    excludedTerms: ['外包'],
    remoteAccepted: null,
  },
  education: [],
  workExperience: [],
  projects: [],
  skills: [
    { name: 'TypeScript', level: 'proficient', evidence: [{ source: 'resume', quote: 'TS' }] },
    { name: 'RAG', level: 'proficient', evidence: [{ source: 'resume', quote: 'RAG' }] },
  ],
  domains: ['大模型应用'],
  yearsOfExperience: 5,
  managementExperience: false,
});

const job = parseNormalizedJob({
  companyId: parseId('018f0000-0000-7000-8000-00000000c001', 'Company'),
  sourceId: parseId('018f0000-0000-7000-8000-00000000c002', 'JobSource'),
  externalJobId: 'job-1',
  title: '大模型 Agent 开发工程师',
  department: '技术部',
  jobFamily: '研发',
  locations: ['深圳'],
  employmentType: '全职',
  experienceText: '3 年以上',
  educationText: null,
  description: '负责 TypeScript Agent 平台与 RAG 检索系统研发。',
  detailUrl: 'https://careers.example.com/jobs/1',
  applyUrl: 'https://careers.example.com/jobs/1/apply',
  publishedAt: utcInstant(1_700_000_000_000),
});

const understanding = parseJobUnderstanding({
  requiredSkills: [
    { value: 'TypeScript', evidence: [{ field: 'description', quote: 'TypeScript' }] },
    { value: 'RAG', evidence: [{ field: 'description', quote: 'RAG' }] },
  ],
  preferredSkills: [],
  minimumYearsExperience: {
    value: 3,
    evidence: [{ field: 'experienceText', quote: '3 年以上' }],
  },
  seniority: null,
  domains: [{ value: '大模型应用', evidence: [{ field: 'title', quote: '大模型' }] }],
});

function input(overrides: Partial<DeterministicMatchInput> = {}): DeterministicMatchInput {
  return {
    profile,
    job,
    company: { sizeCategory: 'large', industry: '大模型应用' },
    understanding,
    ...overrides,
  };
}

describe('eligibility and deterministic scoring', () => {
  it('uses only current deterministic conditions and no keyword ability score', () => {
    const result = calculateDeterministicMatch(input());
    expect(result.filterStatus).toBe('uncertain');
    expect(result.components.reduce((sum, component) => sum + component.maximumScore, 0)).toBe(100);
    expect(result.components.some((component) => component.dimension === 'skills')).toBe(false);
    expect(result.totalScore).toBe(66.67);
    expect(result.ruleOutcomes.some((outcome) => outcome.status === 'unknown')).toBe(true);
  });

  it('only excludes on explicit location conflict and reports both evidence sides', () => {
    const mismatchedJob = parseNormalizedJob({ ...job, locations: ['北京'] });
    const result = calculateDeterministicMatch(input({ job: mismatchedJob }));
    const rule = result.ruleOutcomes.find((outcome) => outcome.ruleId === 'preference.location');
    expect(result.filterStatus).toBe('excluded');
    expect(rule).toMatchObject({ status: 'fail' });
    expect(rule?.evidence.map((item) => item.source)).toEqual(['preference', 'job']);
  });

  it('does not infer a minimum experience requirement from missing model output', () => {
    const result = calculateDeterministicMatch(input({ understanding: null }));
    expect(
      result.ruleOutcomes.find((outcome) => outcome.ruleId === 'qualification.minimum-experience'),
    ).toBeUndefined();
    expect(result.filterStatus).toBe('uncertain');
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.components.find((component) => component.dimension === 'skills')).toBeUndefined();
  });

  it('rejects historical rule selectors', () => {
    expect(parseMatchRuleset(currentMatchRuleset)).toEqual(currentMatchRuleset);
    expect(() =>
      parseMatchRuleset({
        version: 'invalid',
        weights: { skills: 30, experience: 25, role: 15, industry: 10, location: 15 },
      }),
    ).toThrow();
  });
});

describe('current recommendation filtering and stable sorting', () => {
  const items = [
    {
      jobId: 'job-b',
      jobStatus: 'active' as const,
      filterStatus: 'eligible' as const,
      totalScore: 80,
      publishedAt: null,
      lastSeenAt: 20,
    },
    {
      jobId: 'job-a',
      jobStatus: 'active' as const,
      filterStatus: 'eligible' as const,
      totalScore: 80,
      publishedAt: null,
      lastSeenAt: 20,
    },
    {
      jobId: 'job-closed',
      jobStatus: 'closed' as const,
      filterStatus: 'eligible' as const,
      totalScore: 99,
      publishedAt: 30,
      lastSeenAt: 30,
    },
    {
      jobId: 'job-excluded',
      jobStatus: 'active' as const,
      filterStatus: 'excluded' as const,
      totalScore: 90,
      publishedAt: 30,
      lastSeenAt: 30,
    },
  ];

  it('defaults to active non-excluded jobs and uses job ID as the final tie-breaker', () => {
    expect(sortMatches(filterCurrentRecommendations(items)).map((item) => item.jobId)).toEqual([
      'job-a',
      'job-b',
    ]);
  });

  it('shows closed and excluded historical results only when explicitly requested', () => {
    expect(
      filterCurrentRecommendations(items, { includeClosed: true, includeExcluded: true }).map(
        (item) => item.jobId,
      ),
    ).toContain('job-closed');
  });
});

describe('job advice Agent', () => {
  it('rejects removed confirmation fields instead of converting historical advice', () => {
    expect(() =>
      parseStoredJobAdvice({
        highlights: [],
        gaps: [],
        preparation: ['确认到岗日期'],
        uncertainties: [{ text: '确认到岗日期' }, { text: '补充项目成果' }],
      }),
    ).toThrow();
    expect(() =>
      parseJobAdviceOutput({
        highlights: [],
        gaps: [],
        preparation: Array.from({ length: 6 }, () => '准备案例'),
      }),
    ).toThrow();
  });
  const output = {
    highlights: [{ text: '技能与岗位匹配。' }],
    gaps: [],
    preparation: ['准备架构案例。'],
  };
  it('uses the versioned reference-free schema', () => {
    expect(parseJobAdviceOutput(output)).toEqual(output);
  });
  it('rejects stored references, resume emphasis and inline reference IDs', () => {
    expect(() => parseJobAdviceOutput({ ...output, uncertainties: [] })).toThrow();
    expect(() => parseJobAdviceOutput({ ...output, resumeEmphasis: [] })).toThrow();
    expect(() =>
      parseJobAdviceOutput({
        ...output,
        highlights: [{ text: '匹配', references: ['ref-1'] }],
      }),
    ).toThrow();
    expect(() =>
      parseJobAdviceOutput({ ...output, gaps: [{ text: '待补充（ref-1）' }] }),
    ).toThrow();
  });
});

/** 按匹配评测契约即时构造最小样本，避免测试依赖私有或过期评测文件。 */
function matchingGoldenCase(factConsistent: boolean): unknown {
  return {
    id: 'unit-case',
    profile,
    jobs: [
      {
        job,
        company: { sizeCategory: 'large', industry: '大模型应用' },
        understanding,
        relevant: true,
        mustNotExclude: true,
      },
    ],
    adviceSamples: [
      {
        externalJobId: job.externalJobId,
        factConsistent,
        output: {
          highlights: [
            {
              text: '证据支持的建议。',
            },
          ],
          gaps: [],
          preparation: [],
        },
      },
    ],
  };
}

describe('matching golden-case evaluation', () => {
  it('measures ranking, false exclusions, and advice factual consistency', () => {
    const match = calculateDeterministicMatch(input());
    const evidence = match.components.flatMap((component) => component.matchedEvidence)[0];
    if (!evidence) throw new Error('Expected deterministic evidence.');
    expect(evaluateMatchingGoldenCase(matchingGoldenCase(true), { topK: 1 })).toEqual({
      topK: 1,
      topKRelevant: 1,
      topKRelevantRate: 1,
      falseExclusions: 0,
      adviceSamples: 1,
      factConsistentAdvice: 1,
      adviceFactConsistencyRate: 1,
    });
  });

  it('uses independent factual annotations instead of assuming valid JSON is factual', () => {
    expect(evaluateMatchingGoldenCase(matchingGoldenCase(false)).adviceFactConsistencyRate).toBe(0);
  });
});
