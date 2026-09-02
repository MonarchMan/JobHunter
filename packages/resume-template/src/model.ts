import type { CandidateProfileData } from '@jobhunter/domain';
import { z } from 'zod';

const text = z.string().trim();
const optionalText = text.nullable();
const period = {
  startDate: optionalText,
  endDate: optionalText,
};

export const resumeDocumentContentSchema = z
  .object({
    basicInfo: z.object({
      name: optionalText,
      phone: optionalText,
      email: optionalText,
      location: optionalText,
      website: optionalText,
    }),
    targetRoles: z.array(text),
    education: z.array(
      z.object({
        institution: optionalText,
        degree: optionalText,
        field: optionalText,
        ...period,
      }),
    ),
    workExperience: z.array(
      z.object({
        organization: optionalText,
        title: text,
        ...period,
        highlights: z.array(text),
      }),
    ),
    projects: z.array(
      z.object({
        name: text,
        role: optionalText,
        ...period,
        highlights: z.array(text),
      }),
    ),
    works: z.array(z.object({ name: text, description: optionalText, url: optionalText })),
    competitions: z.array(z.object({ name: text, award: optionalText, date: optionalText })),
    certificates: z.array(z.object({ name: text, issuer: optionalText, date: optionalText })),
    languages: z.array(z.object({ name: text, proficiency: optionalText })),
    professionalSkills: optionalText,
    selfEvaluation: optionalText,
  })
  .readonly();

export type ResumeDocumentContent = z.infer<typeof resumeDocumentContentSchema>;

export const resumeSectionIds = [
  'basic',
  'target',
  'education',
  'work',
  'projects',
  'works',
  'competitions',
  'certificates',
  'languages',
  'skills',
  'evaluation',
] as const;

export type ResumeSectionId = (typeof resumeSectionIds)[number];

export const resumeSectionLabels: Readonly<Record<ResumeSectionId, string>> = {
  basic: '基本信息',
  target: '求职方向',
  education: '教育经历',
  work: '工作经历',
  projects: '项目经历',
  works: '作品',
  competitions: '竞赛',
  certificates: '证书',
  languages: '语言能力',
  skills: '专业技能',
  evaluation: '自我评价',
};

export function profileToResumeContent(profile: CandidateProfileData): ResumeDocumentContent {
  const professionalSkills =
    profile.professionalSkills ??
    (profile.skills.length > 0 ? profile.skills.map((skill) => skill.name).join('、') : null);
  return resumeDocumentContentSchema.parse({
    basicInfo: profile.basicInfo,
    targetRoles: profile.targetRoles,
    education: profile.education.map(({ institution, degree, field, startDate, endDate }) => ({
      institution,
      degree,
      field,
      startDate,
      endDate,
    })),
    workExperience: profile.workExperience.map(
      ({ organization, title, startDate, endDate, highlights }) => ({
        organization,
        title,
        startDate,
        endDate,
        highlights,
      }),
    ),
    projects: profile.projects.map(({ name, role, startDate, endDate, highlights }) => ({
      name,
      role,
      startDate,
      endDate,
      highlights,
    })),
    works: profile.works,
    competitions: profile.competitions,
    certificates: profile.certificates,
    languages: profile.languages,
    professionalSkills,
    selfEvaluation: profile.selfEvaluation,
  });
}
