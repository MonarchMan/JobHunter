import {
  parseCandidateProfile,
  parseNormalizedJob,
  type CandidateProfileData,
} from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  calculateDeterministicMatch,
  matchRulesetV3,
  parseDeterministicMatchOutput,
  type DeterministicMatchOutput,
  type DeterministicMatchInput,
} from '../src/index.js';

const ruleset = matchRulesetV3;
const baseProfile = parseCandidateProfile({
  targetRoles: ['研发'],
  preferences: {
    locations: [],
    companySizes: [],
    employmentTypes: [],
    excludedTerms: [],
    remoteAccepted: null,
  },
  education: [],
  workExperience: [],
  projects: [],
  skills: [],
  domains: [],
  yearsOfExperience: 1,
  managementExperience: null,
});
const baseJob = parseNormalizedJob({
  companyId: '018f0000-0000-7000-8000-000000000001',
  sourceId: '018f0000-0000-7000-8000-000000000002',
  externalJobId: 'evidence-case',
  title: '后端开发工程师',
  department: null,
  jobFamily: '研发',
  locations: [],
  employmentType: '全职',
  experienceText: null,
  educationText: null,
  recruitmentCategory: 'social',
  description: '要求 Java；负责接口开发',
  detailUrl: 'https://example.com/jobs/1',
  applyUrl: 'https://example.com/jobs/1',
  publishedAt: null,
});
const facts = {
  targetSubfamily: null,
  graduationYear: null,
  studentStatus: 'graduated' as const,
  internshipDaysPerWeek: null,
  internshipMonths: null,
  availableFrom: null,
};

/** 每个边界样本只改所需事实，结果必须能通过生产持久化 Schema。 */
function run(
  description: string,
  profile: Partial<CandidateProfileData> = {},
  category: 'social' | 'campus' | 'internship' = 'social',
): DeterministicMatchOutput {
  return parseDeterministicMatchOutput(
    calculateDeterministicMatch(
      {
        profile: parseCandidateProfile({ ...baseProfile, ...profile }),
        job: { ...baseJob, description, recruitmentCategory: category },
        understanding: null,
        company: { sizeCategory: null, industry: null },
      },
      ruleset,
    ),
  );
}

/** 读取特定分项，失败时给出明确断言而非隐式 undefined。 */
function component(
  result: DeterministicMatchOutput,
  dimension: string,
): DeterministicMatchOutput['components'][number] {
  const value = result.components.find((item) => item.dimension === dimension);
  if (!value) throw new Error(`Missing ${dimension}`);
  return value;
}

describe('v3 requirement meaning and evidence', () => {
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
    expect(run(text, { yearsOfExperience: years }).filterStatus).toBe(expected);
  });
  it('keeps local waivers and three-valued qualification alternatives', () => {
    expect(
      run('要求不限年级的在校生', { matchingConstraints: facts }, 'internship').filterStatus,
    ).toBe('excluded');
    expect(run('2026-02-30前到岗', { matchingConstraints: facts }, 'internship').filterStatus).toBe(
      'uncertain',
    );
    expect(
      run('要求在校生且年级不限', { matchingConstraints: facts }, 'internship').filterStatus,
    ).toBe('excluded');
    expect(run('不要求在校生', { matchingConstraints: facts }, 'internship').filterStatus).toBe(
      'eligible',
    );
    expect(run('要求3年以上工作经验或硕士学历', { yearsOfExperience: 1 }).filterStatus).toBe(
      'uncertain',
    );
    expect(run('要求3年以上工作经验或硕士学历', { yearsOfExperience: 4 }).filterStatus).toBe(
      'eligible',
    );
  });
  it('distinguishes any/all skill requirements and scopes preferred clauses', () => {
    const profile = { skills: [{ name: 'Java', level: null, evidence: [] }] };
    expect(component(run('掌握Java或Python任一语言', profile), 'skills').score).toBe(24);
    expect(component(run('掌握Java和Python', profile), 'skills').score).toBe(12);
    expect(component(run('必须掌握Java且Python优先', profile), 'skills').score).toBe(18);
    expect(component(run('掌握Java，Python优先', profile), 'skills').score).toBe(18);
  });
  it.each(['尚未掌握Java', '计划学习Java', '不熟悉Java', '没有Java经验', '未掌握Java'])(
    'does not award positive skill evidence for %s',
    (text) => {
      expect(component(run('要求Java', { professionalSkills: text }), 'skills').score).toBe(0);
    },
  );
  it('ignores waived job skills and does not promote learning to practical use', () => {
    expect(
      component(run('不要求Java或Python', { professionalSkills: '熟练使用Java' }), 'skills')
        .evidenceStatus,
    ).toBe('unknown');
    expect(
      component(run('必须掌握Java，Python优先', { professionalSkills: '熟练使用Java' }), 'skills')
        .score,
    ).toBe(18);
    expect(
      component(run('要求Java', { professionalSkills: '熟练使用JavaScript' }), 'skills').score,
    ).toBe(0);
    expect(
      component(run('不要求Java经验', { professionalSkills: '熟练使用Java' }), 'skills')
        .evidenceStatus,
    ).toBe('unknown');
    expect(
      component(
        run('要求Java', {
          workExperience: [
            {
              organization: null,
              title: '开发实习生',
              startDate: null,
              endDate: null,
              highlights: ['计划学习Java'],
              evidence: [],
            },
          ],
        }),
        'skills',
      ).score,
    ).toBe(0);
  });
  it('finds real use in projects and retains both evidence sides', () => {
    const result = run('要求Java', {
      projects: [
        {
          name: '接口服务',
          role: '开发',
          startDate: null,
          endDate: null,
          highlights: ['使用Java实现接口服务'],
          evidence: [],
        },
      ],
    });
    expect(component(result, 'skills').score).toBe(30);
    expect(new Set(component(result, 'skills').matchedEvidence.map((item) => item.source))).toEqual(
      new Set(['profile', 'job']),
    );
  });
  it('resolves degree alternatives without requiring every alternative', () => {
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
    expect(run('要求本科或硕士学历', { education }).filterStatus).toBe('eligible');
    expect(run('要求3年工作经验或硕士学历', { education, yearsOfExperience: 1 }).filterStatus).toBe(
      'excluded',
    );
    expect(
      run('要求3年工作经验或（硕士且有证书）', { education, yearsOfExperience: 4 }).filterStatus,
    ).toBe('uncertain');
  });
  it('keeps company introductions outside requirements and supports extended aliases', () => {
    expect(
      component(
        run('公司介绍：使用Java\n任职要求：熟悉Kotlin', { professionalSkills: '熟悉kotlin' }),
        'skills',
      ).score,
    ).toBe(24);
  });
  it('does not let enhanced skill labels override a waiver or a choice group', () => {
    const input: DeterministicMatchInput = {
      profile: { ...baseProfile, professionalSkills: '熟悉Java' },
      job: { ...baseJob, description: '不要求Java；要求Java或Python任选一项' },
      company: { sizeCategory: null, industry: null },
      understanding: {
        requiredSkills: [
          { value: 'Java', evidence: [{ field: 'description', quote: 'Java' }] },
          { value: 'Python', evidence: [{ field: 'description', quote: 'Python' }] },
        ],
        preferredSkills: [],
        minimumYearsExperience: null,
        seniority: null,
        domains: [],
      },
    };
    expect(
      component(
        parseDeterministicMatchOutput(calculateDeterministicMatch(input, ruleset)),
        'skills',
      ).score,
    ).toBe(24);
    expect(
      component(
        parseDeterministicMatchOutput(
          calculateDeterministicMatch(
            { ...input, job: { ...input.job, description: '不要求Java或Python' } },
            ruleset,
          ),
        ),
        'skills',
      ).evidenceStatus,
    ).toBe('unknown');
  });
  it('keeps experience weight on experience-unrestricted jobs', () => {
    const result = run('工作经验不限；要求Java；负责接口开发', {
      workExperience: [
        {
          organization: null,
          title: '后端开发',
          startDate: null,
          endDate: null,
          highlights: ['使用Java负责接口开发并上线接口服务'],
          evidence: [],
        },
      ],
    });
    expect(component(result, 'experience').maximumScore).toBe(30);
    expect(component(result, 'experience').score).toBeGreaterThan(0);
    expect(component(result, 'skills').maximumScore).toBe(30);
    expect(component(run('经验不限'), 'experience').evidenceStatus).toBe('unknown');
  });
  it('matches responsibilities and contribution without rewarding repetition or unrelated boasts', () => {
    const project = (text: string): CandidateProfileData['projects'][number] => ({
      name: '服务项目',
      role: null,
      startDate: null,
      endDate: null,
      highlights: [text],
      evidence: [],
    });
    const description = '要求Java；负责接口开发';
    const participating = run(description, { projects: [project('使用Java参与接口开发')] });
    const owning = run(description, { projects: [project('使用Java负责接口开发')] });
    const delivered = project('使用Java负责接口开发并上线接口服务');
    const full = run(description, { projects: [delivered] });
    expect(component(owning, 'projects').score).toBeGreaterThan(
      component(participating, 'projects').score,
    );
    expect(component(full, 'projects').score).toBeGreaterThan(component(owning, 'projects').score);
    expect(
      component(run(description, { projects: [delivered, delivered] }), 'projects').score,
    ).toBe(component(full, 'projects').score);
    expect(
      component(
        run(description, {
          projects: [project('使用Java参与接口开发；独立负责活动运营并成功上线，提升1000%')],
        }),
        'projects',
      ).score,
    ).toBe(component(participating, 'projects').score);
  });
});
