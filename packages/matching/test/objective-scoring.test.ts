import { describe, expect, it } from 'vitest';
import { parseCandidateProfile } from '@jobhunter/user/contracts';
import { parseNormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import {
  buildProfileSnapshot,
  calculateDeterministicMatch,
  jobUnderstandingInputSchema,
  matchEvidenceCoverage,
  matchRulesetV4,
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
