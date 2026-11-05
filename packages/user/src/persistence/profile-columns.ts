import { parseCandidateProfile, type CandidateProfileData } from '@jobhunter/user/domain';

/** 画像字段与存储列的唯一映射；集合按字段编码，不保存整份画像副本。 */
export const profileColumns = {
  matchingConstraints: 'matching_constraints_json',
  basicInfo: 'basic_info_json',
  targetRoles: 'target_roles_json',
  intendedRoles: 'intended_roles_json',
  preferences: 'preferences_json',
  education: 'education_json',
  workExperience: 'work_experience_json',
  projects: 'projects_json',
  works: 'works_json',
  competitions: 'competitions_json',
  certificates: 'certificates_json',
  languages: 'languages_json',
  professionalSkills: 'professional_skills',
  selfEvaluation: 'self_evaluation',
  skills: 'skills_json',
  domains: 'domains_json',
  yearsOfExperience: 'years_of_experience',
  managementExperience: 'management_experience',
} as const;

/** 从明确的画像列还原领域对象。 */
export function readProfileColumns(row: Record<string, unknown>): CandidateProfileData {
  const profile: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(profileColumns)) {
    const value = row[column];
    profile[key] = column.endsWith('_json')
      ? JSON.parse(String(value))
      : key === 'managementExperience' && value !== null
        ? Boolean(value)
        : value;
  }
  if (JSON.stringify(profile.matchingConstraints) === '{}') delete profile.matchingConstraints;
  if (JSON.stringify(profile.basicInfo) === '{}') delete profile.basicInfo;
  return parseCandidateProfile(profile);
}

/** 将领域画像转换为参数绑定值，禁止调用方拼接用户内容。 */
export function writeProfileColumns(profile: CandidateProfileData): (string | number | null)[] {
  return Object.entries(profileColumns).map(([key, column]) => {
    const value = profile[key as keyof CandidateProfileData];
    if (column.endsWith('_json'))
      return JSON.stringify(value ?? (key === 'matchingConstraints' ? {} : []));
    return typeof value === 'boolean' ? Number(value) : (value as string | number | null);
  });
}
