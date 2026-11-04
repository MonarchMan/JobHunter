import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/user/contracts';
import { parseNormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import { describe, expect, it } from 'vitest';
import { calculateDeterministicMatch, parseDeterministicMatchOutput } from '../src/index.js';

const profile = parseCandidateProfile({
  targetRoles: ['研发'],
  domains: [],
  education: [],
  skills: [],
  projects: [],
  workExperience: [],
  yearsOfExperience: 1,
  managementExperience: null,
  preferences: {
    locations: [],
    companySizes: [],
    employmentTypes: [],
    excludedTerms: [],
    remoteAccepted: null,
  },
});
const job = parseNormalizedJob({
  companyId: '018f0000-0000-7000-8000-000000000001',
  sourceId: '018f0000-0000-7000-8000-000000000002',
  externalJobId: 'qualification-case',
  title: '后端开发工程师',
  department: null,
  jobFamily: '研发',
  locations: [],
  employmentType: '全职',
  experienceText: null,
  educationText: null,
  recruitmentCategory: 'social',
  description: '要求 Java',
  detailUrl: 'https://example.com/jobs/1',
  applyUrl: 'https://example.com/jobs/1',
  publishedAt: null,
});

/** 保留原有资格解析回归，只通过当前引擎计算，不维护旧算法测试。 */
function score(
  description: string,
  facts: Partial<CandidateProfileData> = {},
  category: 'social' | 'internship' = 'social',
): ReturnType<typeof calculateDeterministicMatch> {
  return parseDeterministicMatchOutput(
    calculateDeterministicMatch({
      profile: parseCandidateProfile({ ...profile, ...facts }),
      job: { ...job, description, recruitmentCategory: category },
      company: { sizeCategory: null, industry: null },
      understanding: null,
    }),
  );
}

describe('current qualification semantics', () => {
  it.each([
    ['要求3年以下工作经验', 1, 'eligible'],
    ['要求3年以下工作经验', 4, 'excluded'],
    ['要求至少三年工作经验', 1, 'excluded'],
    ['要求至少三年工作经验', 3, 'eligible'],
    ['要求三至五年工作经验', 4, 'eligible'],
    ['要求三至五年工作经验', 6, 'excluded'],
    ['要求不满三年工作经验', 3, 'excluded'],
    ['要求超过三年工作经验', 3, 'excluded'],
    ['必须具备3年工作经验且有Java经验优先', 1, 'excluded'],
    ['3年工作经验优先', 1, 'eligible'],
    ['工作经验不限', 0, 'eligible'],
    ['工作经验不少于3年', 1, 'excluded'],
    ['工作经验不低于3年', 3, 'eligible'],
    ['工作经验不少于3年且不超过5年', 6, 'excluded'],
    ['工作经验不少于3年且不超过5年', 4, 'eligible'],
  ] as const)('compares %s with %s years', (text, years, expected) => {
    expect(score(text, { yearsOfExperience: years }).filterStatus).toBe(expected);
  });

  it('preserves three-valued alternatives and local waivers', () => {
    const matchingConstraints = {
      targetSubfamily: null,
      graduationYear: null,
      studentStatus: 'graduated' as const,
      internshipDaysPerWeek: null,
      internshipMonths: null,
      availableFrom: null,
    };
    expect(score('要求不限年级的在校生', { matchingConstraints }, 'internship').filterStatus).toBe(
      'excluded',
    );
    expect(score('要求在校生且年级不限', { matchingConstraints }, 'internship').filterStatus).toBe(
      'excluded',
    );
    expect(score('不要求在校生', { matchingConstraints }, 'internship').filterStatus).toBe(
      'eligible',
    );
    expect(score('2026-02-30前到岗', { matchingConstraints }, 'internship').filterStatus).toBe(
      'uncertain',
    );
    expect(score('要求3年以上工作经验或硕士学历', { yearsOfExperience: 1 }).filterStatus).toBe(
      'uncertain',
    );
    expect(score('要求3年以上工作经验或硕士学历', { yearsOfExperience: 4 }).filterStatus).toBe(
      'eligible',
    );
  });

  it('resolves degree alternatives without silently accepting unsupported nesting', () => {
    const education = [
      {
        institution: null,
        degree: '本科',
        field: null,
        startDate: null,
        endDate: null,
        evidence: [],
      },
    ];
    expect(score('要求本科或硕士学历', { education }).filterStatus).toBe('eligible');
    expect(
      score('要求3年工作经验或硕士学历', { education, yearsOfExperience: 1 }).filterStatus,
    ).toBe('excluded');
    expect(
      score('要求3年工作经验或（硕士且有证书）', { education, yearsOfExperience: 4 }).filterStatus,
    ).toBe('uncertain');
  });
});
