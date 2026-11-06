import { z } from 'zod';

/** 建议只输出用户可读文本，禁止内部引用编号进入正文或存储。 */
const adviceText = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((text) => !/ref-\d+/i.test(text), 'Advice must not contain reference IDs.');
const advicePointSchema = z.object({ text: adviceText }).strict();

/** v4 建议仅保留亮点、缺口和准备行动。 */
export const jobAdviceSchema = z
  .object({
    highlights: z.array(advicePointSchema).max(1),
    gaps: z.array(advicePointSchema).max(1),
    preparation: z.array(adviceText).max(8),
  })
  .strict();

/** 经边界校验的职位准备建议。 */
export type JobAdvice = z.infer<typeof jobAdviceSchema>;

/** 存储读取与新输出使用同一契约，不兼容或转换旧字段。 */
export function parseStoredJobAdvice(value: unknown): JobAdvice {
  return jobAdviceSchema.parse(value);
}

/** 分析 Agent 的建议块最多五项行动，统一用于边界与评测。 */
export function parseJobAdviceOutput(value: unknown): JobAdvice {
  return jobAdviceSchema
    .extend({ preparation: jobAdviceSchema.shape.preparation.max(5) })
    .parse(value);
}
