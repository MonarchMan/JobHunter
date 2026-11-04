import { z } from 'zod';
import { parseId, type MatchRulesetId } from '@jobhunter/common/domain';

/** 当前规则的存储身份；不再用于选择历史引擎。 */
export const defaultMatchRulesetId: MatchRulesetId = parseId(
  '018f0000-0000-7000-8000-000000000307',
  'MatchRuleset',
);

/** 规则只记录实际配置，不包含手工版本或历史引擎选择。 */
export const matchRulesetSchema = z
  .object({
    conditionWeight: z.literal('equal'),
    roleIsHardFilter: z.literal(false),
    ruleWeight: z.literal(0.3),
    modelWeight: z.literal(0.7),
  })
  .strict();

/** 当前确定性规则配置。 */
export type MatchRuleset = z.infer<typeof matchRulesetSchema>;
/** 与当前评分实现保持一致的唯一配置。 */
export const currentMatchRuleset: MatchRuleset = Object.freeze({
  conditionWeight: 'equal',
  roleIsHardFilter: false,
  ruleWeight: 0.3,
  modelWeight: 0.7,
});

/** 按当前严格契约读取规则配置，不兼容历史定义。 */
export function parseMatchRuleset(input: unknown): MatchRuleset {
  return matchRulesetSchema.parse(input);
}
