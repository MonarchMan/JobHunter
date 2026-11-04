import { z } from 'zod';
import { parseId, type MatchRulesetId } from '@jobhunter/common/domain';

/** v5 默认规则集使用独立身份，初始化与任务装配一致，不覆盖旧 v4 的 306 身份。 */
export const defaultMatchRulesetId: MatchRulesetId = parseId(
  '018f0000-0000-7000-8000-000000000307',
  'MatchRuleset',
);
import type { ScoreDimension } from './model.js';

const dimensions = [
  'skills',
  'experience',
  'role',
  'industry',
  'location',
  'projects',
  'qualification',
] as const;

/** 旧权重不补写 projects 字段，保持历史定义哈希不变。 */
const weightsSchema = z
  .object({
    skills: z.number().int().nonnegative(),
    experience: z.number().int().nonnegative(),
    role: z.number().int().nonnegative(),
    industry: z.number().int().nonnegative(),
    location: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative().optional(),
    qualification: z.number().int().nonnegative().optional(),
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
    engine: z
      .enum(['evidence-v3', 'evidence-v3.1', 'evidence-v3.2', 'objective-v4', 'objective-v5'])
      .optional(),
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

/** v3.2 隔离毕业资格修复，不修改旧版定义或评分权重。 */
export const matchRulesetV32: MatchRuleset = parseMatchRuleset({
  ...matchRulesetV31,
  version: 'v3.2',
  engine: 'evidence-v3.2',
});

/** v4 仅对客观条件评分，语义能力交给模型；旧定义保持不变。 */
export const matchRulesetV4: MatchRuleset = parseMatchRuleset({
  version: 'v4',
  engine: 'objective-v4',
  weights: {
    skills: 0,
    experience: 0,
    role: 0,
    industry: 0,
    location: 0,
    projects: 0,
    qualification: 100,
  },
});

/** v5 规则覆盖岗位方向、地点及资格条件，模型仍可综合同一维度。 */
export const matchRulesetV5: MatchRuleset = parseMatchRuleset({
  ...matchRulesetV4,
  version: 'v5',
  engine: 'objective-v5',
});

/** 校验并解析匹配规则集。 */
export function parseMatchRuleset(input: unknown): MatchRuleset {
  return matchRulesetSchema.parse(input);
}

/** 获取指定评分维度的权重；模型维度不占用规则集权重。 */
export function weightFor(
  ruleset: MatchRuleset,
  dimension: Exclude<ScoreDimension, 'model'>,
): number {
  return ruleset.weights[dimension] ?? 0;
}
