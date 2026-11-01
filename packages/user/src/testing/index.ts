import { parseCandidateProfile, type CandidateProfileData } from '../domain/index.js';
/** 创建测试用候选人简历档案。 */
export function makeCandidateProfile(
  overrides: Partial<CandidateProfileData> = {},
): CandidateProfileData {
  return parseCandidateProfile({
    targetRoles: ['Agent 开发', '大模型应用'],
    preferences: {
      locations: ['北京'],
      companySizes: ['large', 'medium'],
      employmentTypes: ['全职'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [],
    domains: ['大模型应用'],
    yearsOfExperience: null,
    managementExperience: null,
    ...overrides,
  });
}
