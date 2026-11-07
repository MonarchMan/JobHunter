/** 沿用模型评分规范的四档阈值，仅表达展示契合度，不修改评分或筛选结果。 */
export function scoreBand(score: number | null): {
  readonly key: 'high' | 'good' | 'partial' | 'low' | 'unknown';
  readonly label: string;
} {
  if (score === null) return { key: 'unknown', label: '未评分' };
  if (score >= 80) return { key: 'high', label: '高契合' };
  if (score >= 60) return { key: 'good', label: '较契合' };
  if (score >= 40) return { key: 'partial', label: '部分契合' };
  return { key: 'low', label: '低契合' };
}
