import { z } from 'zod';
import type { ScoreDimension } from './model.js';

const dimensions = ['skills', 'experience', 'role', 'industry', 'location'] as const;

/** 匹配规则集定义 Schema。 */
export const matchRulesetSchema = z
  .object({
    version: z.string().trim().min(1),
    weights: z.object({
      skills: z.number().int().nonnegative(),
      experience: z.number().int().nonnegative(),
      role: z.number().int().nonnegative(),
      industry: z.number().int().nonnegative(),
      location: z.number().int().nonnegative(),
    }),
  })
  .strict()
  .refine(
    (ruleset) => dimensions.reduce((sum, key) => sum + ruleset.weights[key], 0) === 100,
    'Match ruleset weights must sum to 100.',
  );

/** 模块使用的类型约束。 */
export type MatchRuleset = z.infer<typeof matchRulesetSchema>;

/** 模块使用的稳定配置或常量。 */
export const matchRulesetV1: MatchRuleset = Object.freeze({
  version: 'v1',
  weights: { skills: 35, experience: 25, role: 15, industry: 10, location: 15 },
});

/** 校验并解析匹配规则集。 */
export function parseMatchRuleset(input: unknown): MatchRuleset {
  return matchRulesetSchema.parse(input);
}

/** 获取指定评分维度的权重。 */
export function weightFor(ruleset: MatchRuleset, dimension: ScoreDimension): number {
  return ruleset.weights[dimension];
}
