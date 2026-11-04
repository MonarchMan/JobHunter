/** 规则分与模型分的加权权重；模型分缺失时规则分独占全部权重。 */
export const scoreWeights = { rules: 0.3, model: 0.7 } as const;

/** 仅规则分的历史与降级口径；加权口径随规则集版本一起进入匹配身份。 */
export const rulesOnlyScoringVersion = 'rules-v1';
/** 规则分 30% 与模型分 70% 加权口径。 */
export const weightedScoringVersion = 'weighted-v1';

/** 模块使用的类型约束。 */
export interface ScoreComposition {
  readonly totalScore: number;
  readonly modelScore: number | null;
  readonly scoringVersion: string;
}

/** 按固定权重合成最终分；模型分缺失时不猜测，退回规则分口径。 */
export function composeMatchScore(rulesTotal: number, modelScore: number | null): ScoreComposition {
  if (modelScore === null)
    return { totalScore: rulesTotal, modelScore: null, scoringVersion: rulesOnlyScoringVersion };
  const total = rulesTotal * scoreWeights.rules + modelScore * scoreWeights.model;
  return {
    totalScore: Math.min(100, Math.round(total * 100) / 100),
    modelScore,
    scoringVersion: weightedScoringVersion,
  };
}
