import { z } from 'zod';

/** 建议只输出用户可读文本，禁止内部引用编号进入正文或存储。 */
const adviceText = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((text) => !/ref-\d+/i.test(text), 'Advice must not contain reference IDs.');
const advicePointSchema = z.object({ text: adviceText }).strict();

/** v4 建议仅保留亮点、缺口和准备行动；八项上限容纳旧建议合并后的展示。 */
export const jobAdviceSchema = z
  .object({
    highlights: z.array(advicePointSchema).max(1),
    gaps: z.array(advicePointSchema).max(1),
    preparation: z.array(adviceText).max(8),
  })
  .strict();

/** 经边界校验的职位准备建议。 */
export type JobAdvice = z.infer<typeof jobAdviceSchema>;

/** 仅存储读取边界接受旧待确认字段，合并后返回新结构，不回写历史数据。 */
export function parseStoredJobAdvice(value: unknown): JobAdvice {
  if (typeof value !== 'object' || value === null || !('uncertainties' in value)) {
    return jobAdviceSchema.parse(value);
  }
  const legacy = jobAdviceSchema
    .extend({
      uncertainties: z.array(advicePointSchema).max(3),
      preparation: z.array(adviceText).max(5),
    })
    .parse(value);
  return jobAdviceSchema.parse({
    highlights: legacy.highlights,
    gaps: legacy.gaps,
    preparation: [
      ...new Set([...legacy.preparation, ...legacy.uncertainties.map((item) => item.text)]),
    ],
  });
}
