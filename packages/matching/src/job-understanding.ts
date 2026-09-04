import { z } from 'zod';

const text = z.string().trim().min(1);

/** 职位理解结果引用的原文证据。 */
export const jobEvidenceSchema = z
  .object({
    field: z.enum(['title', 'description', 'experienceText', 'educationText']),
    quote: text.max(240),
  })
  .strict();

const evidencedText = z
  .object({ value: text, evidence: z.array(jobEvidenceSchema).min(1) })
  .strict();

/** 结构化职位理解结果。 */
export const jobUnderstandingSchema = z
  .object({
    requiredSkills: z.array(evidencedText),
    preferredSkills: z.array(evidencedText),
    minimumYearsExperience: z
      .object({ value: z.number().nonnegative(), evidence: z.array(jobEvidenceSchema).min(1) })
      .strict()
      .nullable(),
    seniority: evidencedText.nullable(),
    domains: z.array(evidencedText),
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobUnderstanding = z.infer<typeof jobUnderstandingSchema>;

/** 校验并解析职位理解结果。 */
export function parseJobUnderstanding(input: unknown): JobUnderstanding {
  return jobUnderstandingSchema.parse(input);
}
