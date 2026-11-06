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

/** 职位事实字段；拟合判断与理由在 v2 追加，单独声明避免历史存储缺字段。 */
const jobUnderstandingFacts = {
  requiredSkills: z.array(evidencedText),
  preferredSkills: z.array(evidencedText),
  minimumYearsExperience: z
    .object({ value: z.number().nonnegative(), evidence: z.array(jobEvidenceSchema).min(1) })
    .strict()
    .nullable(),
  seniority: evidencedText.nullable(),
  domains: z.array(evidencedText),
} as const;

/** 结构化职位理解结果；拟合分与理由自 v2 起输出，v1 历史记录允许缺失。 */
export const jobUnderstandingSchema = z
  .object({
    ...jobUnderstandingFacts,
    fitScore: z.number().int().min(0).max(100).optional(),
    reasons: z.array(text.max(300)).min(1).max(5).optional(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobUnderstanding = z.infer<typeof jobUnderstandingSchema>;

/** 校验并解析职位理解结果。 */
export function parseJobUnderstanding(input: unknown): JobUnderstanding {
  return jobUnderstandingSchema.parse(input);
}
