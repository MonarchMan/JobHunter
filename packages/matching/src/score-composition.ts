/** 规则分与模型分的加权权重；模型分缺失时规则分独占全部权重。 */
export const scoreWeights = { rules: 0.3, model: 0.7 } as const;

/** 模块使用的类型约束。 */
export interface ScoreComposition {
  readonly totalScore: number;
  readonly modelScore: number | null;
}

/** 按固定权重合成最终分；模型分缺失时不猜测，退回规则分口径。 */
export function composeMatchScore(rulesTotal: number, modelScore: number | null): ScoreComposition {
  if (modelScore === null) return { totalScore: rulesTotal, modelScore: null };
  const total = rulesTotal * scoreWeights.rules + modelScore * scoreWeights.model;
  return {
    totalScore: Math.min(100, Math.round(total * 100) / 100),
    modelScore,
  };
}
