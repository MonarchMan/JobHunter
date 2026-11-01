import { z } from 'zod';
/** 建议引用的职位或简历证据。 */
export const adviceReferenceSchema = z
  .object({
    kind: z.enum(['evidence', 'missing', 'uncertainty']),
    value: z.string().trim().min(1).max(500),
  })
  .strict();

const advicePointSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    references: z.array(adviceReferenceSchema).min(1).max(8),
  })
  .strict();

/** 职位准备建议结构。 */
export const jobAdviceSchema = z
  .object({
    highlights: z.array(advicePointSchema).max(10),
    gaps: z.array(advicePointSchema).max(10),
    uncertainties: z.array(advicePointSchema).max(10),
    resumeEmphasis: z.array(z.string().trim().min(1).max(500)).max(10),
    preparation: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobAdvice = z.infer<typeof jobAdviceSchema>;
