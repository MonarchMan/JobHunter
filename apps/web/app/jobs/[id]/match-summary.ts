import type { WebJobDetail } from '@jobhunter/matching/contracts/web';
type Match = WebJobDetail['matches'][number];

/** 规则标识映射为简洁名称；数据中不重复保存展示文案。 */
export function ruleLabel(id: string): string {
  const labels: Record<string, string> = {
    'preference.role': '岗位方向',
    'preference.location': '工作地点',
    'preference.company-size': '公司规模',
    'preference.employment-type': '用工类型',
    'preference.excluded-terms': '排除词',
    'qualification.condition': '岗位资格要求',
    'qualification.minimum-experience': '工作经验',
    'qualification.graduation-v3.2': '毕业条件',
    'qualification.recruitment-category': '招聘类别',
  };
  return labels[id] ?? id;
}

/** 将等权条件展开为具体规则行；独立分项只隐藏展示，仍计入总分母。 */
export function objectiveRuleRows(
  outcomes: Match['ruleOutcomes'],
  separateDimensions = false,
): {
  readonly key: string;
  readonly label: string;
  readonly score: number;
  readonly maximumScore: number;
}[] {
  const labels: Readonly<Record<string, string>> = {
    'preference.location': '地点',
    'preference.company-size': '公司规模',
    'preference.employment-type': '用工类型',
    'preference.excluded-terms': '排除词',
  };
  const conditions = outcomes.filter(
    (item) => item.ruleId !== 'qualification.recruitment-category',
  );
  return conditions
    .map((item, index) => ({
      key: `${item.ruleId}:${String(index)}`,
      // 资格解析可能包含与/或组合，保留完整条款，避免误标为单一学历或年限要求。
      label:
        labels[item.ruleId] ??
        item.evidence.find((entry) => entry.source === 'job')?.summary ??
        item.explanation,
      score: item.status === 'pass' ? 100 / conditions.length : 0,
      maximumScore: 100 / conditions.length,
    }))
    .filter(
      (item) =>
        !separateDimensions ||
        (!item.key.startsWith('preference.role:') && !item.key.startsWith('preference.location:')),
    );
}

/** 缺口只汇总适用规则维度，去除重复提示词并保留缺失证据的语义。 */
export function ruleGaps(components: Match['components']): string[] {
  return [
    ...new Set(
      components
        .filter((item) => item.dimension !== 'model' && item.evidenceStatus !== 'not_applicable')
        .flatMap((item) => item.missingEvidence)
        .map((value) =>
          value
            .replace(/^缺口[：:]\s*/, '')
            .replace(/^未找到正向证据[：:]\s*/, '')
            .replace(/^未找到相关职责与贡献证据[：:]\s*(.+)$/, '$1实践')
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
}
