import { z } from 'zod';
import type { ScoreDimension } from './model.js';

const dimensions = ['skills', 'experience', 'role', 'industry', 'location', 'projects'] as const;

/** 旧权重不补写 projects 字段，保持历史定义哈希不变。 */
const weightsSchema = z
  .object({
    skills: z.number().int().nonnegative(),
    experience: z.number().int().nonnegative(),
    role: z.number().int().nonnegative(),
    industry: z.number().int().nonnegative(),
    location: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (weights) => dimensions.reduce((sum, key) => sum + (weights[key] ?? 0), 0) === 100,
    'Match ruleset weights must sum to 100.',
  );

/** 匹配规则集定义 Schema。 */
export const matchRulesetSchema = z
  .object({
    version: z.string().trim().min(1),
    weights: weightsSchema,
    engine: z.enum(['evidence-v3', 'evidence-v3.1']).optional(),
    recruitmentWeights: z
      .object({ social: weightsSchema, campus: weightsSchema, internship: weightsSchema })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (ruleset) => dimensions.reduce((sum, key) => sum + (ruleset.weights[key] ?? 0), 0) === 100,
    'Match ruleset weights must sum to 100.',
  );

/** 模块使用的类型约束。 */
export type MatchRuleset = z.infer<typeof matchRulesetSchema>;

/** 模块使用的稳定配置或常量。 */
export const matchRulesetV1: MatchRuleset = Object.freeze({
  version: 'v1',
  weights: { skills: 35, experience: 25, role: 15, industry: 10, location: 15 },
});

/** 三类岗位共用引擎与不可变 v2 版本，禁止用全局同步渠道选权重。 */
export const matchRulesetV2: MatchRuleset = parseMatchRuleset({
  version: 'v2',
  weights: { skills: 30, experience: 30, projects: 15, role: 15, industry: 5, location: 5 },
  recruitmentWeights: {
    social: { skills: 30, experience: 30, projects: 15, role: 15, industry: 5, location: 5 },
    campus: { skills: 30, experience: 15, projects: 30, role: 15, industry: 0, location: 10 },
    internship: { skills: 35, experience: 0, projects: 30, role: 20, industry: 0, location: 15 },
  },
});

/** v3 冻结证据引擎版本，继承三类权重但不改变旧规则的重放路径。 */
export const matchRulesetV3: MatchRuleset = parseMatchRuleset({
  ...matchRulesetV2,
  version: 'v3',
  engine: 'evidence-v3',
});

/** v3.1 仅修复介绍段落边界，旧 v3 定义与解释路径不变。 */
export const matchRulesetV31: MatchRuleset = parseMatchRuleset({
  ...matchRulesetV3,
  version: 'v3.1',
  engine: 'evidence-v3.1',
});

/** 校验并解析匹配规则集。 */
export function parseMatchRuleset(input: unknown): MatchRuleset {
  return matchRulesetSchema.parse(input);
}

/** 获取指定评分维度的权重。 */
export function weightFor(ruleset: MatchRuleset, dimension: ScoreDimension): number {
  return ruleset.weights[dimension] ?? 0;
}
