import { normalizeJobTaxonomy, type NormalizedJob } from '@jobhunter/recruitment/contracts/domain';
import type { ScoreComponent } from './model.js';

/** 用岗位分类比较明确方向，不依赖能力关键词或历史评分引擎。 */
export function roleRatio(
  targets: readonly string[],
  subfamily: string | null,
  job: NormalizedJob,
): number | null {
  const explicit = normalizeJobTaxonomy(job.jobFamily);
  const title = normalizeJobTaxonomy(job.title);
  const family = explicit.jobFamily === '其他' ? title.jobFamily : explicit.jobFamily;
  const sub = normalizeJobTaxonomy(job.jobSubfamily ?? job.title).jobSubfamily;
  if (family === '其他' || targets.length === 0) return null;
  const taxonomies = targets
    .map((target) => normalizeJobTaxonomy(target))
    .filter((item) => item.jobFamily !== '其他');
  if (!taxonomies.length) return null;
  return Math.max(
    ...taxonomies.map((taxonomy) => {
      if (taxonomy.jobFamily !== family) return 0;
      const desiredSub = subfamily
        ? normalizeJobTaxonomy(subfamily).jobSubfamily
        : taxonomy.jobSubfamily;
      return desiredSub && sub ? (desiredSub === sub ? 1 : 0.4) : 0.7;
    }),
  );
}

/** 根据快照的分项证据计算完整度；没有记录证据状态时不猜测。 */
export function matchEvidenceCoverage(components: readonly ScoreComponent[]): number | null {
  if (!components.length || components.some((item) => item.evidenceStatus === undefined))
    return null;
  const applicable = components.filter((item) => item.evidenceStatus !== 'not_applicable');
  const total = applicable.reduce((sum, item) => sum + item.maximumScore, 0);
  return total === 0
    ? 0
    : Math.round(
        (applicable.reduce(
          (sum, item) =>
            sum +
            (item.maximumScore *
              (item.evidenceCoverage ?? (item.evidenceStatus === 'known' ? 100 : 0))) /
              100,
          0,
        ) /
          total) *
          100,
      );
}
