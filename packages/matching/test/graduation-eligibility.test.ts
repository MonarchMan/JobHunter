import { parseCandidateProfile, parseNormalizedJob } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  calculateDeterministicMatch,
  matchRulesetV31,
  matchRulesetV32,
  parseDeterministicMatchOutput,
  type DeterministicMatchInput,
} from '../src/index.js';

/** 合成输入只声明教育结束日期，不从系统时间推导学籍。 */
function input(
  description: string,
  dates: (string | null)[],
  category: 'internship' | 'campus' = 'internship',
): DeterministicMatchInput {
  return {
    profile: parseCandidateProfile({
      targetRoles: [],
      preferences: {
        locations: [],
        companySizes: [],
        employmentTypes: [],
        excludedTerms: [],
        remoteAccepted: null,
      },
      education: dates.map((endDate) => ({
        institution: null,
        degree: null,
        field: null,
        startDate: null,
        endDate,
        evidence: [],
      })),
      workExperience: [],
      projects: [],
      skills: [],
      domains: [],
      yearsOfExperience: null,
      managementExperience: null,
    }),
    job: parseNormalizedJob({
      companyId: '018f0000-0000-7000-8000-000000000001',
      sourceId: '018f0000-0000-7000-8000-000000000002',
      externalJobId: 'graduation',
      title: '开发',
      department: null,
      jobFamily: '研发',
      locations: [],
      employmentType: null,
      educationText: null,
      experienceText: null,
      recruitmentCategory: category,
      description,
      detailUrl: 'https://example.com/job',
      applyUrl: 'https://example.com/job',
      publishedAt: null,
    }),
    understanding: null,
    company: { sizeCategory: null, industry: null },
  };
}

describe('MCH-023 graduation eligibility', () => {
  it('recognizes a structured education field without inventing a residual qualification', () => {
    const sample = input('负责开发', ['2027-07']);
    expect(
      calculateDeterministicMatch(
        { ...sample, job: { ...sample.job, educationText: '仅限2027届毕业生' } },
        matchRulesetV32,
      ).filterStatus,
    ).toBe('eligible');
  });
  it.each([
    ['面向2027届毕业生（2026年9月-2027年8月期间毕业）', ['2026-09'], 'eligible'],
    ['2026-09至2027-08毕业', ['2027-08'], 'eligible'],
    ['2026-09至2027-08毕业', ['2026-08'], 'excluded'],
    ['2026-09至2027-08毕业', ['2027-09'], 'excluded'],
    ['2026-09至2027-08毕业', ['2025-07', '2028-07'], 'excluded'],
    ['2026-09至2027-08毕业', ['2025-07', '2027-07'], 'uncertain'],
    ['2026-09至2027-08毕业', ['2026-12', '2027-07'], 'eligible'],
    ['2026-09至2027-08毕业', ['2025-07', null], 'uncertain'],
    ['2026-09至2027-08毕业', ['2027'], 'uncertain'],
    ['2026-09至2027-08毕业', ['2027-02-30'], 'uncertain'],
    ['2026-13至2027-08毕业', ['2027-07'], 'uncertain'],
    ['2027-09至2026-08毕业', ['2027-07'], 'uncertain'],
    ['2026-09至2027-08毕业', [], 'uncertain'],
    ['仅限2026届、2028届', ['2027-07'], 'excluded'],
    ['仅限2026届、2028届', ['2028-07'], 'eligible'],
    ['仅限26、28届', ['2026-07'], 'eligible'],
    ['仅限2026至2028届', ['2027-07'], 'eligible'],
    ['25届、26届在校生均可', ['2025-07', '2028-07'], 'uncertain'],
    ['2027届优先', ['2028-07'], 'eligible'],
    ['2027届（特殊情况另议）', ['2028-07'], 'uncertain'],
    ['2027届及以后', ['2028-07'], 'uncertain'],
    ['非2027届', ['2027-07'], 'uncertain'],
    ['2026-09至2027-08毕业且每周至少4天', ['2027-07'], 'uncertain'],
    ['2027届或具备相关工作经验', ['2028-07'], 'uncertain'],
    ['2027届在读', ['2027-07'], 'uncertain'],
  ] as const)('%s / %j → %s', (text, dates, expected) => {
    const result = parseDeterministicMatchOutput(
      calculateDeterministicMatch(input(text, [...dates]), matchRulesetV32),
    );
    expect(result.filterStatus).toBe(expected);
  });
  it('applies to campus too and preserves scores, evidence and historical version replay', () => {
    const sample = input(
      '面向2027届毕业生（2026年9月-2027年8月期间毕业）',
      ['2025-07', '2028-07'],
      'campus',
    );
    const previous = calculateDeterministicMatch(sample, matchRulesetV31);
    const current = calculateDeterministicMatch(sample, matchRulesetV32);
    expect(previous.filterStatus).toBe('uncertain');
    expect(current.filterStatus).toBe('excluded');
    expect(current.components).toEqual(previous.components);
    expect(current.totalScore).toBe(previous.totalScore);
    expect(
      current.ruleOutcomes.flatMap((item) => item.evidence).map((item) => item.path),
    ).toContain('/education/1/endDate');
    expect(calculateDeterministicMatch(sample, matchRulesetV31)).toEqual(previous);
    expect(calculateDeterministicMatch(sample, matchRulesetV32)).toEqual(current);
  });
});
