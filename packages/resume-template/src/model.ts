import type { CandidateProfileData } from '@jobhunter/domain';
import { z } from 'zod';

const text = z.string().trim();
const optionalText = text.nullable();
const period = {
  startDate: optionalText,
  endDate: optionalText,
};

/** 在线简历编辑器支持的章节标识。 */
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

/** 模块使用的类型约束。 */
export type ResumeSectionId = (typeof resumeSectionIds)[number];

/** 单个简历章节的可编辑排版参数。 */
export const resumeTextStyleSchema = z
  .object({
    fontSize: z.number().min(9).max(24),
    letterSpacing: z.number().min(-0.5).max(3),
    lineHeight: z.number().min(1.2).max(2),
  })
  .readonly();

/** 模块使用的类型约束。 */
export type ResumeTextStyle = z.infer<typeof resumeTextStyleSchema>;

/** 在线简历草稿内容 Schema，统一编辑、渲染和导出输入。 */
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
    formatting: z.partialRecord(z.enum(resumeSectionIds), resumeTextStyleSchema).optional(),
  })
  .readonly();

/** 模块使用的类型约束。 */
export type ResumeDocumentContent = z.infer<typeof resumeDocumentContentSchema>;

/** 章节标识到中文展示名称的映射。 */
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

/** 从画像中的结构化技能和领域生成默认投递描述。 */
function skillSummary(profile: CandidateProfileData): string | null {
  const sentences: string[] = [];
  if (profile.skills.length > 0)
    sentences.push(`技术技能：${profile.skills.map((skill) => skill.name).join('、')}。`);
  if (profile.domains.length > 0) sentences.push(`相关领域：${profile.domains.join('、')}。`);
  return sentences.length > 0 ? sentences.join('\n') : null;
}

/** 将候选人画像转换为可编辑的在线简历草稿内容。 */
export function profileToResumeContent(profile: CandidateProfileData): ResumeDocumentContent {
  const professionalSkills = profile.professionalSkills ?? skillSummary(profile);
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
