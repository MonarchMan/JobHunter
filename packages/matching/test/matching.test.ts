import { parseCandidateProfile, parseId, parseNormalizedJob, utcInstant } from '@jobhunter/domain';
import { assertPromptMatchesDefinition } from '@jobhunter/agent-core';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  calculateDeterministicMatch,
  evaluateMatchingGoldenCase,
  filterCurrentRecommendations,
  jobAdviceAgentDefinition,
  jobAdvicePromptV1,
  jobUnderstandingAgentDefinition,
  jobUnderstandingPromptV1,
  matchRulesetV1,
  parseJobUnderstanding,
  parseJobUnderstandingAgentOutput,
  parseJobAdviceAgentOutput,
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
  it('keeps JobUnderstanding prompt versions aligned and rejects fabricated evidence', () => {
    expect(() => {
      assertPromptMatchesDefinition(jobUnderstandingPromptV1, jobUnderstandingAgentDefinition);
    }).not.toThrow();
    expect(() =>
      parseJobUnderstandingAgentOutput(
        {
          requiredSkills: [
            { value: 'Python', evidence: [{ field: 'description', quote: '不存在的 Python' }] },
          ],
          preferredSkills: [],
          minimumYearsExperience: null,
          seniority: null,
          domains: [],
        },
        {
          title: job.title,
          description: job.description,
          experienceText: job.experienceText,
          educationText: job.educationText,
        },
      ),
    ).toThrow(/evidence is not present/);
  });

  it('produces five evidence-backed full-score components with the v1 weights', () => {
    const result = calculateDeterministicMatch(input());
    expect(matchRulesetV1.weights).toEqual({
      skills: 35,
      experience: 25,
      role: 15,
      industry: 10,
      location: 15,
    });
    expect(result.filterStatus).toBe('eligible');
    expect(result.components.map((component) => component.maximumScore)).toEqual([
      35, 25, 15, 10, 15,
    ]);
    expect(result.totalScore).toBe(100);
    expect(result.components.every((component) => component.matchedEvidence.length > 0)).toBe(true);
  });

  it('only excludes on explicit location conflict and reports both evidence sides', () => {
    const mismatchedJob = parseNormalizedJob({ ...job, locations: ['北京'] });
    const result = calculateDeterministicMatch(input({ job: mismatchedJob }));
    const rule = result.ruleOutcomes.find((outcome) => outcome.ruleId === 'preference.location');
    expect(result.filterStatus).toBe('excluded');
    expect(rule).toMatchObject({ status: 'fail' });
    expect(rule?.evidence.map((item) => item.source)).toEqual(['preference', 'job']);
  });

  it('treats missing experience evidence as unknown and still computes a base score', () => {
    const result = calculateDeterministicMatch(input({ understanding: null }));
    expect(
      result.ruleOutcomes.find((outcome) => outcome.ruleId === 'qualification.minimum-experience'),
    ).toMatchObject({ status: 'unknown' });
    expect(result.filterStatus).toBe('uncertain');
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.components.find((component) => component.dimension === 'skills')).toMatchObject({
      uncertainties: ['未使用语义增强，技能分数来自职位文本关键词。'],
    });
  });

  it('rejects rulesets whose weights do not sum to 100', () => {
    expect(() =>
      parseMatchRuleset({
        version: 'invalid',
        weights: { skills: 30, experience: 25, role: 15, industry: 10, location: 15 },
      }),
    ).toThrow(/sum to 100/);
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
  it('keeps prompt metadata aligned and accepts references from deterministic evidence', () => {
    expect(() => {
      assertPromptMatchesDefinition(jobAdvicePromptV1, jobAdviceAgentDefinition);
    }).not.toThrow();
    const match = calculateDeterministicMatch(input());
    const evidence = match.components.flatMap((component) => component.matchedEvidence)[0];
    if (!evidence) throw new Error('Expected deterministic evidence.');
    expect(
      parseJobAdviceAgentOutput(
        {
          highlights: [
            {
              text: '技能与岗位匹配。',
              references: [{ kind: 'evidence', value: evidence.summary }],
            },
          ],
          gaps: [],
          uncertainties: [],
          resumeEmphasis: ['突出已有项目。'],
          preparation: ['准备架构案例。'],
        },
        { profile, job, match },
      ),
    ).toMatchObject({ highlights: [{ text: '技能与岗位匹配。' }] });
  });

  it('rejects advice references that are absent from deterministic evidence', () => {
    const match = calculateDeterministicMatch(input());
    expect(() =>
      parseJobAdviceAgentOutput(
        {
          highlights: [
            {
              text: '虚构事实。',
              references: [{ kind: 'evidence', value: '不存在的经历' }],
            },
          ],
          gaps: [],
          uncertainties: [],
          resumeEmphasis: [],
          preparation: [],
        },
        { profile, job, match },
      ),
    ).toThrow(/absent from the match evidence/);
  });
});

describe('matching golden-set evaluation', () => {
  it('measures ranking, false exclusions, and advice factual consistency from a file', async () => {
    const path = new URL(
      '../../../evals/job-matching/cases/redacted-agent-jobs.json',
      import.meta.url,
    );
    const goldenCase = JSON.parse(await readFile(path, 'utf8')) as unknown;
    expect(evaluateMatchingGoldenCase(goldenCase, { topK: 2 })).toEqual({
      topK: 2,
      topKRelevant: 2,
      topKRelevantRate: 1,
      falseExclusions: 0,
      adviceSamples: 1,
      factConsistentAdvice: 1,
      adviceFactConsistencyRate: 1,
    });
  });

  it('counts fabricated advice references as factual failures', async () => {
    const path = new URL(
      '../../../evals/job-matching/cases/redacted-agent-jobs.json',
      import.meta.url,
    );
    const goldenCase = JSON.parse(await readFile(path, 'utf8')) as {
      adviceSamples: { output: { highlights: { references: { value: string }[] }[] } }[];
    };
    const reference = goldenCase.adviceSamples[0]?.output.highlights[0]?.references[0];
    if (!reference) throw new Error('Expected a golden advice reference.');
    reference.value = '虚构经历';
    expect(evaluateMatchingGoldenCase(goldenCase).adviceFactConsistencyRate).toBe(0);
  });
});
