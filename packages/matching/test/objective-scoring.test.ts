import { describe, expect, it } from 'vitest';
import { hashCanonical } from '@jobhunter/common/agent';
import { parseCandidateProfile } from '@jobhunter/user/contracts';
import { parseNormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import {
  buildProfileSnapshot,
  calculateDeterministicMatch,
  jobUnderstandingInputSchema,
  matchEvidenceCoverage,
  matchRulesetV4,
  matchRulesetV5,
  jobUnderstandingAgentDefinition,
  jobUnderstandingPromptV4,
  parseDeterministicMatchOutput,
} from '../src/index.js';

const profile = parseCandidateProfile({
  targetRoles: [],
  domains: [],
  education: [],
  skills: [],
  projects: [],
  workExperience: [],
  yearsOfExperience: null,
  managementExperience: null,
  preferences: {
    locations: ['深圳'],
    companySizes: [],
    employmentTypes: [],
    excludedTerms: [],
    remoteAccepted: null,
  },
});

describe('v5 overlapping rule and model dimensions', () => {
  /** 固定同一画像和职位，单独观察方向、地点及资格的计分与过滤。 */
  function current(
    targetRoles: string[],
    overrides: Partial<typeof job> = {},
  ): ReturnType<typeof calculateDeterministicMatch> {
    return parseDeterministicMatchOutput(
      calculateDeterministicMatch(
        {
          profile: { ...profile, targetRoles },
          job: { ...job, ...overrides },
          company: { sizeCategory: null, industry: null },
          understanding: null,
        },
        matchRulesetV5,
      ),
    );
  }
  it('shows role and location separately and gives each applicable condition equal weight', () => {
    const result = current(['后端开发']);
    expect(result.totalScore).toBe(100);
    expect(result.components.map((item) => [item.dimension, item.maximumScore])).toEqual([
      ['role', 50],
      ['location', 50],
    ]);
    expect(result.filterStatus).toBe('eligible');
    expect(current([]).components.map((item) => item.dimension)).toEqual(['location']);
    const withQualification = current(['后端开发'], { educationText: '要求本科学历' });
    expect(withQualification.components.map((item) => item.dimension)).toEqual([
      'role',
      'location',
      'qualification',
    ]);
    expect(withQualification.components.reduce((sum, item) => sum + item.maximumScore, 0)).toBe(
      100,
    );
  });
  it('does not hard-exclude role mismatches but preserves explicit location exclusions', () => {
    const mismatch = current(['财务']);
    expect(mismatch.totalScore).toBe(50);
    expect(mismatch.filterStatus).toBe('eligible');
    expect(mismatch.ruleOutcomes.find((item) => item.ruleId === 'preference.role')?.status).toBe(
      'fail',
    );
    expect(current(['后端开发'], { locations: ['北京'] }).filterStatus).toBe('excluded');
    expect(current(['后端开发'], { locations: [] }).filterStatus).toBe('uncertain');
  });
  it('does not pretend unfamiliar role classifications match', () => {
    const unknown = current(['未登记的方向']);
    expect(unknown.filterStatus).toBe('uncertain');
    expect(unknown.components.find((item) => item.dimension === 'role')).toMatchObject({
      score: 0,
      evidenceStatus: 'unknown',
    });
  });
  it('passes overlapping criteria without personal contact fields and changes the model identity', () => {
    const snapshot = buildProfileSnapshot(profile);
    expect(snapshot.preferences).toEqual(profile.preferences);
    expect(snapshot.education).toEqual(profile.education);
    expect(snapshot).not.toHaveProperty('basicInfo');
    expect(jobUnderstandingAgentDefinition.promptVersion).toBe(
      jobUnderstandingPromptV4.promptVersion,
    );
    expect(jobUnderstandingAgentDefinition.version).toBe('4.0.0');
    expect(jobUnderstandingPromptV4.text).toContain('综合岗位方向、工作地点');
    expect(jobUnderstandingPromptV4.text).not.toContain('不得在 fitScore 重复扣分');
    const input = {
      title: job.title,
      description: job.description,
      experienceText: null,
      educationText: null,
      recruitmentCategory: 'internship',
      locations: job.locations,
      employmentType: job.employmentType,
      company: { sizeCategory: null, industry: null },
      profile: snapshot,
    };
    expect(jobUnderstandingInputSchema.parse(input)).toEqual(input);
    expect(
      hashCanonical(
        jobUnderstandingInputSchema.parse({
          ...input,
          profile: buildProfileSnapshot({
            ...profile,
            preferences: { ...profile.preferences, locations: ['北京'] },
          }),
        }),
      ),
    ).not.toBe(hashCanonical(jobUnderstandingInputSchema.parse(input)));
  });
});
const job = parseNormalizedJob({
  companyId: '018f0000-0000-7000-8000-000000000001',
  sourceId: '018f0000-0000-7000-8000-000000000002',
  externalJobId: 'objective-case',
  title: '后端开发实习生',
  description: '要求熟悉 Python、SQL，具有检索项目实践',
  department: null,
  jobFamily: null,
  locations: ['深圳'],
  employmentType: '实习',
  experienceText: null,
  educationText: null,
  recruitmentCategory: 'internship',
  detailUrl: 'https://example.com/jobs/1',
  applyUrl: 'https://example.com/jobs/1',
  publishedAt: null,
});

/** 使用同一职位快照验证客观条件不受能力文本变化影响。 */
function score(
  description = job.description,
  locations = job.locations,
): ReturnType<typeof calculateDeterministicMatch> {
  return parseDeterministicMatchOutput(
    calculateDeterministicMatch(
      {
        profile,
        job: { ...job, description, locations },
        company: { sizeCategory: null, industry: null },
        understanding: null,
      },
      matchRulesetV4,
    ),
  );
}

describe('v4 objective scoring', () => {
  it('does not score skill or practice keywords and excludes unset preferences', () => {
    const result = score();
    expect(result.totalScore).toBe(100);
    expect(result.components.map((item) => item.dimension)).toEqual(['qualification']);
    expect(result.components[0]?.missingEvidence).toEqual([]);
    expect(score('要求 Java、Rust 和分布式系统实践').totalScore).toBe(result.totalScore);
    expect(result.ruleOutcomes.some((item) => item.ruleId === 'preference.company-size')).toBe(
      false,
    );
  });

  it('keeps missing numeric facts unknown and reports partial coverage', () => {
    const result = score('任职要求：\n每周至少实习3天');
    expect(result.filterStatus).toBe('uncertain');
    expect(result.totalScore).toBe(50);
    expect(matchEvidenceCoverage(result.components)).toBe(50);
    expect(result.components[0]?.missingEvidence).toEqual([]);
    expect(result.components[0]?.uncertainties.length).toBeGreaterThan(0);
  });

  it('excludes only explicit conflicts and does not add preferred criteria', () => {
    expect(score(job.description, ['北京']).filterStatus).toBe('excluded');
    expect(score(job.description, []).filterStatus).toBe('uncertain');
    expect(score('任职要求：\n本科优先').totalScore).toBe(100);
  });

  it('passes project and work evidence to the model without contact information', () => {
    const candidate = parseCandidateProfile({
      ...profile,
      basicInfo: {
        name: '测试',
        phone: '123456',
        email: 'test@example.com',
        location: null,
        website: null,
      },
      projects: [
        {
          name: '检索系统',
          role: '开发',
          startDate: null,
          endDate: null,
          highlights: ['实现混合检索'],
          evidence: [{ source: 'resume', quote: '实现混合检索' }],
        },
      ],
      workExperience: [
        {
          organization: '合成公司',
          title: '实习生',
          startDate: null,
          endDate: null,
          highlights: ['优化接口延迟'],
          evidence: [],
        },
      ],
    });
    const snapshot = buildProfileSnapshot(candidate);
    expect(snapshot.projects).toEqual(candidate.projects);
    expect(snapshot.workExperience).toEqual(candidate.workExperience);
    expect(snapshot).not.toHaveProperty('basicInfo');
    expect(
      jobUnderstandingInputSchema.safeParse({
        title: job.title,
        description: job.description,
        experienceText: null,
        educationText: null,
        recruitmentCategory: 'internship',
        profile: snapshot,
      }).success,
    ).toBe(true);
  });
});
