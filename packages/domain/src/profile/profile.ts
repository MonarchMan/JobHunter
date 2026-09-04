import { z } from 'zod';

const normalizedText = z.string().trim().min(1);
const optionalText = normalizedText.nullable();
const evidenceSchema = z
  .object({
    source: z.enum(['resume', 'manual']),
    quote: normalizedText.nullable(),
  })
  .readonly();

const datedExperience = {
  startDate: normalizedText.nullable(),
  endDate: normalizedText.nullable(),
  highlights: z.array(normalizedText),
  evidence: z.array(evidenceSchema),
};

/** 候选人项目经历的领域 Schema。 */
export const candidateProjectSchema = z
  .object({
    name: normalizedText,
    role: normalizedText.nullable(),
    ...datedExperience,
  })
  .readonly();

/** 领域模型的类型约束。 */
export type CandidateProject = z.infer<typeof candidateProjectSchema>;

/** 候选人求职偏好 Schema。 */
export const candidatePreferencesSchema = z
  .object({
    locations: z.array(normalizedText),
    companySizes: z.array(z.enum(['large', 'medium', 'other'])),
    employmentTypes: z.array(normalizedText),
    excludedTerms: z.array(normalizedText),
    remoteAccepted: z.boolean().nullable(),
  })
  .readonly();

/** 候选人画像完整领域 Schema，负责统一默认值和文本约束。 */
export const candidateProfileSchema = z
  .object({
    basicInfo: z
      .object({
        name: optionalText,
        phone: optionalText,
        email: optionalText,
        location: optionalText,
        website: optionalText,
      })
      .readonly()
      .default({ name: null, phone: null, email: null, location: null, website: null }),
    targetRoles: z.array(normalizedText),
    preferences: candidatePreferencesSchema,
    education: z.array(
      z
        .object({
          institution: normalizedText.nullable(),
          degree: normalizedText.nullable(),
          field: normalizedText.nullable(),
          startDate: normalizedText.nullable(),
          endDate: normalizedText.nullable(),
          evidence: z.array(evidenceSchema),
        })
        .readonly(),
    ),
    workExperience: z.array(
      z
        .object({
          organization: normalizedText.nullable(),
          title: normalizedText,
          ...datedExperience,
        })
        .readonly(),
    ),
    projects: z.array(candidateProjectSchema),
    works: z
      .array(
        z.object({ name: normalizedText, description: optionalText, url: optionalText }).readonly(),
      )
      .default([]),
    competitions: z
      .array(z.object({ name: normalizedText, award: optionalText, date: optionalText }).readonly())
      .default([]),
    certificates: z
      .array(
        z.object({ name: normalizedText, issuer: optionalText, date: optionalText }).readonly(),
      )
      .default([]),
    languages: z
      .array(z.object({ name: normalizedText, proficiency: optionalText }).readonly())
      .default([]),
    professionalSkills: optionalText.default(null),
    selfEvaluation: optionalText.default(null),
    skills: z.array(
      z
        .object({
          name: normalizedText,
          level: z.enum(['familiar', 'proficient', 'expert', 'uncertain']).nullable(),
          evidence: z.array(evidenceSchema),
        })
        .readonly(),
    ),
    domains: z.array(normalizedText),
    yearsOfExperience: z.number().nonnegative().nullable(),
    managementExperience: z.boolean().nullable(),
  })
  .readonly();

/** 领域模型的类型约束。 */
export type CandidateProfileData = z.infer<typeof candidateProfileSchema>;

/** 在领域边界校验并返回候选人画像。 */
export function parseCandidateProfile(input: unknown): CandidateProfileData {
  return candidateProfileSchema.parse(input);
}
