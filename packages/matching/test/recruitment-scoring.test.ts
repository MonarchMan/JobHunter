import { parseCandidateProfile, parseId, parseNormalizedJob } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  calculateDeterministicMatch,
  matchRulesetV1,
  matchRulesetV2,
  matchEvidenceCoverage,
  parseDeterministicMatchOutput,
  parseMatchRuleset,
  recruitmentCategory,
  type DeterministicMatchInput,
} from '../src/index.js';

/** 脱敏黄金输入，完全离线；三类职位共用候选事实以比较政策差异。 */
const base: DeterministicMatchInput = {
  profile: parseCandidateProfile({
    targetRoles: ['研发'],
    preferences: {
      locations: ['深圳'],
      companySizes: [],
      employmentTypes: [],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [{ name: 'TS', level: null, evidence: [] }],
    domains: [],
    yearsOfExperience: null,
    managementExperience: null,
  }),
  job: parseNormalizedJob({
    companyId: parseId('018f0000-0000-7000-8000-00000000c001', 'Company'),
    sourceId: parseId('018f0000-0000-7000-8000-00000000c002', 'JobSource'),
    externalJobId: 'v2-golden',
    title: '前端开发工程师',
    jobFamily: '研发',
    recruitmentCategory: 'internship',
    department: null,
    locations: ['深圳'],
    employmentType: '全职',
    experienceText: null,
    educationText: null,
    description: '要求 TypeScript；React 优先',
    detailUrl: 'https://example.com/jobs/1',
    applyUrl: 'https://example.com/jobs/1',
    publishedAt: null,
  }),
  company: { sizeCategory: null, industry: null },
  understanding: null,
};
const facts = {
  targetSubfamily: null,
  graduationYear: null,
  studentStatus: null,
  internshipDaysPerWeek: null,
  internshipMonths: null,
  availableFrom: null,
} as const;

/** 构造指定类别与原文的有效输入，所有评分必须通过持久化边界 Schema。 */
function evaluate(
  category: 'social' | 'campus' | 'internship',
  description = base.job.description,
  profile = base.profile,
): ReturnType<typeof calculateDeterministicMatch> {
  return parseDeterministicMatchOutput(
    calculateDeterministicMatch(
      { ...base, profile, job: { ...base.job, recruitmentCategory: category, description } },
      matchRulesetV2,
    ),
  );
}

describe('recruitment-specific matching v2', () => {
  it('records an offline v1/v2 comparison without treating higher scores as better rankings', () => {
    const comparison = (['social', 'campus', 'internship'] as const).map((category) => {
      const input = { ...base, job: { ...base.job, recruitmentCategory: category } };
      const previous = calculateDeterministicMatch(input, matchRulesetV1);
      const current = evaluate(category);
      return {
        category,
        v1: previous.totalScore,
        v2: current.totalScore,
        coverage: matchEvidenceCoverage(current.components),
        excluded: current.filterStatus === 'excluded',
      };
    });
    expect(comparison.map((item) => item.v2)).toEqual([38, 43, 55.25]);
    expect(comparison.map((item) => item.v1)).toEqual([32.5, 32.5, 32.5]);
    expect(comparison.map((item) => item.coverage)).toEqual([50, 55, 70]);
    expect(comparison.filter((item) => item.excluded)).toHaveLength(0);
    console.info('Offline policy comparison (not ranking accuracy):', comparison);
  });
  it.each([
    ['social', [30, 30, 15, 15, 5, 5]],
    ['campus', [30, 15, 30, 15, 0, 10]],
    ['internship', [35, 0, 30, 20, 0, 15]],
  ] as const)('freezes %s weights and validates their sum', (category, weights) => {
    expect(evaluate(category).components.map((item) => item.maximumScore)).toEqual(weights);
    expect(() =>
      parseMatchRuleset({
        ...matchRulesetV2,
        recruitmentWeights: {
          ...matchRulesetV2.recruitmentWeights,
          [category]: { ...matchRulesetV2.recruitmentWeights?.[category], skills: 99 },
        },
      }),
    ).toThrow();
  });
  it('keeps v1 output compatible and uses the frozen category, not full-time or title', () => {
    expect(matchRulesetV1.weights).not.toHaveProperty('projects');
    const legacy = calculateDeterministicMatch(base, matchRulesetV1);
    expect(legacy.components).toHaveLength(5);
    expect(matchEvidenceCoverage(legacy.components)).toBeNull();
    expect(recruitmentCategory({ ...base.job, title: '校招工程师' })).toBe('internship');
    expect(recruitmentCategory({ ...base.job, recruitmentCategory: null })).toBe('unknown');
    const unknown = calculateDeterministicMatch(
      { ...base, job: { ...base.job, recruitmentCategory: null } },
      matchRulesetV2,
    );
    expect(unknown).toMatchObject({ totalScore: 0, filterStatus: 'uncertain' });
  });
  it('uses aliases and required/preferred coverage without Java/JavaScript collisions', () => {
    expect(evaluate('internship').components[0]?.score).toBe(26.25);
    const profile = {
      ...base.profile,
      skills: [{ name: 'JavaScript', level: null, evidence: [] }],
    };
    expect(evaluate('internship', '要求 Java', profile).components[0]?.score).toBe(0);
    expect(
      evaluate('internship', '要求 TypeScript；TypeScript', {
        ...base.profile,
        skills: [],
        professionalSkills: '熟练使用 TS 开发应用',
      }).components[0]?.score,
    ).toBe(35);
  });
  it('does not apply the unconditional social experience gate to students', () => {
    expect(evaluate('internship').filterStatus).toBe('eligible');
    expect(evaluate('campus').filterStatus).toBe('eligible');
    expect(evaluate('social', '要求 3 年工作经验').filterStatus).toBe('uncertain');
    expect(
      evaluate('social', '要求 3 年工作经验', { ...base.profile, yearsOfExperience: 2 })
        .filterStatus,
    ).toBe('excluded');
    expect(evaluate('social', '2026 年招聘，有项目经验优先').filterStatus).toBe('eligible');
  });
  it('checks explicit cohort and fresh-graduate status, but never invents them', () => {
    expect(evaluate('campus', '2026 届应届毕业生').filterStatus).toBe('uncertain');
    expect(
      evaluate('campus', '2026 届应届毕业生', {
        ...base.profile,
        matchingConstraints: { ...facts, graduationYear: 2025, studentStatus: 'graduating' },
      }).filterStatus,
    ).toBe('excluded');
    expect(
      evaluate('campus', '2026-2027 届应届毕业生', {
        ...base.profile,
        matchingConstraints: { ...facts, graduationYear: 2027, studentStatus: 'graduating' },
      }).filterStatus,
    ).toBe('eligible');
  });
  it('checks days, duration, student status and start deadline independently', () => {
    const description = '要求在校生；每周至少3天；实习至少6个月；2026-10-01前到岗';
    expect(evaluate('internship', description).filterStatus).toBe('uncertain');
    const profile = {
      ...base.profile,
      matchingConstraints: {
        ...facts,
        studentStatus: 'student' as const,
        internshipDaysPerWeek: 3,
        internshipMonths: 6,
        availableFrom: '2026-09-20',
      },
    };
    expect(evaluate('internship', description, profile).filterStatus).toBe('eligible');
    for (const change of [
      { internshipDaysPerWeek: 2 },
      { internshipMonths: 3 },
      { studentStatus: 'graduated' as const },
      { availableFrom: '2026-10-02' },
    ]) {
      expect(
        evaluate('internship', description, {
          ...profile,
          matchingConstraints: { ...profile.matchingConstraints, ...change },
        }).filterStatus,
      ).toBe('excluded');
    }
  });
  it('does not hard-exclude preferences or waived student status, even when facts conflict', () => {
    const profile = {
      ...base.profile,
      matchingConstraints: {
        ...facts,
        studentStatus: 'graduated' as const,
        internshipDaysPerWeek: 1,
        graduationYear: 2025,
      },
    };
    expect(
      evaluate('internship', '在校生优先；每周3天优先；不要求在读', profile).filterStatus,
    ).toBe('eligible');
    expect(evaluate('campus', '2026届优先', profile).filterStatus).toBe('eligible');
    expect(evaluate('internship', '在校生优先，但必须每周3天', profile).filterStatus).toBe(
      'excluded',
    );
  });
  it('keeps unparsed requirements pending and distinguishes graduated fresh graduates from students', () => {
    expect(evaluate('social', '至少三年研发经验').filterStatus).toBe('uncertain');
    const profile = {
      ...base.profile,
      matchingConstraints: { ...facts, studentStatus: 'fresh_graduate' as const },
    };
    expect(evaluate('campus', '要求应届毕业生', profile).filterStatus).toBe('eligible');
    expect(evaluate('internship', '要求在校生', profile).filterStatus).toBe('excluded');
    expect(
      evaluate('campus', '2025/2027届', {
        ...profile,
        matchingConstraints: { ...profile.matchingConstraints, graduationYear: 2026 },
      }).filterStatus,
    ).toBe('excluded');
    expect(
      evaluate('campus', '2025/2027届', {
        ...profile,
        matchingConstraints: { ...profile.matchingConstraints, graduationYear: 2025 },
      }).filterStatus,
    ).toBe('eligible');
  });
  it('keeps missing education/credentials uncertain and compares explicit degree facts', () => {
    expect(evaluate('social', '本科及以上学历；必须持有教师资格证').filterStatus).toBe('uncertain');
    const profile = {
      ...base.profile,
      education: [
        {
          institution: null,
          degree: '大专',
          field: null,
          startDate: null,
          endDate: null,
          evidence: [],
        },
      ],
    };
    expect(evaluate('social', '本科及以上学历', profile).filterStatus).toBe('excluded');
    expect(evaluate('social', '本科优先', profile).filterStatus).toBe('eligible');
  });
  it('uses best practice evidence without rewarding duplicate entries or text length', () => {
    const project = {
      name: '前端应用',
      role: '前端',
      startDate: null,
      endDate: null,
      highlights: ['TypeScript React'],
      evidence: [],
    };
    const single = evaluate('internship', undefined, { ...base.profile, projects: [project] });
    expect(single.components.find((item) => item.dimension === 'projects')?.score).toBe(30);
    expect(
      evaluate('internship', undefined, { ...base.profile, projects: [project, project] })
        .totalScore,
    ).toBe(single.totalScore);
    expect(
      evaluate('internship', undefined, {
        ...base.profile,
        workExperience: [{ ...project, title: '前端开发', organization: null }],
      }).components.find((item) => item.dimension === 'projects')?.score,
    ).toBe(30);
  });
  it('keeps unknown weights and distinguishes evidence completeness from score', () => {
    const result = evaluate('internship', '职位内容待补充', {
      ...base.profile,
      targetRoles: [],
      skills: [],
    });
    expect(result.totalScore).toBe(15);
    expect(matchEvidenceCoverage(result.components)).toBe(15);
    expect(result.components.find((item) => item.dimension === 'projects')?.evidenceStatus).toBe(
      'unknown',
    );
    const waived = evaluate('social', '经验不限；要求 TypeScript');
    expect(waived.components.find((item) => item.dimension === 'experience')).toMatchObject({
      maximumScore: 0,
      evidenceStatus: 'not_applicable',
    });
    expect(waived.totalScore).toBeLessThan(100);
  });
  it('truncates long evidence at the storage boundary and retains source paths', () => {
    expect(() => evaluate('social', `要求本科以上学历${'相关说明'.repeat(200)}`)).not.toThrow();
    expect(() =>
      evaluate('internship', undefined, {
        ...base.profile,
        projects: [
          {
            name: '前端',
            role: null,
            startDate: null,
            endDate: null,
            highlights: ['TypeScript'.repeat(200)],
            evidence: [],
          },
        ],
      }),
    ).not.toThrow();
  });
});
