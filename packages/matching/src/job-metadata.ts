import { z } from 'zod';
import { scoreDimensionSchema } from './model.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const ids = z
  .array(z.string().trim().min(1))
  .refine((values) => new Set(values).size === values.length);

/** 当前评分的持久化契约；只保存分数与规则标识，不存重复解释或空证据。 */
export const matchMetadataValueSchema = z
  .object({
    content_id: z.uuidv7(),
    profile_version_id: z.uuidv7(),
    enrichment_id: z.uuidv7().nullable(),
    rules_hash: hash,
    filter_status: z.enum(['eligible', 'excluded', 'uncertain']),
    total_score: z.number().min(0).max(100),
    input_hash: hash,
    components: z.array(
      z
        .object({
          dimension: scoreDimensionSchema.exclude(['model']),
          score: z.number().min(0).max(100),
          max_score: z.number().min(0).max(100),
        })
        .strict()
        .refine((c) => c.score <= c.max_score),
    ),
    risk_results: ids,
    unknown_rules: ids,
    model: z
      .object({
        score: z.number().min(0).max(100),
        reasons: z.array(z.string().trim().min(1).max(300)).max(5),
      })
      .strict()
      .nullable(),
  })
  .strict();
