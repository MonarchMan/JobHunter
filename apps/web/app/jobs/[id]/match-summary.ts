import type { WebJobDetail } from '@jobhunter/matching/contracts/web';
type Match = WebJobDetail['matches'][number];

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
