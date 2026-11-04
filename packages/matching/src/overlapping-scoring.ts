import type {
  DeterministicMatchInput,
  DeterministicMatchOutput,
  RuleOutcome,
  ScoreComponent,
} from './model.js';
import { calculateObjectiveMatch } from './objective-scoring.js';
import { roleRatio } from './recruitment-scoring.js';
import { recruitmentCategory } from './recruitment-requirements.js';

/** 规则覆盖可解释的部分条件，岗位方向只计分；模型评分可再次综合这些维度。 */
export function calculateOverlappingMatch(
  input: DeterministicMatchInput,
): DeterministicMatchOutput {
  // 1、保留原有明确条件与硬过滤，岗位目标属于相关性，不能新增硬排除。
  const base = calculateObjectiveMatch(input);
  const outcomes = [...base.ruleOutcomes];
  const targets = input.profile.targetRoles;
  const subfamily = input.profile.matchingConstraints?.targetSubfamily ?? null;
  if (targets.length || subfamily) {
    const ratio = roleRatio(targets.length ? targets : [subfamily ?? ''], subfamily, input.job);
    outcomes.push({
      ruleId: 'preference.role',
      status: ratio === null ? 'unknown' : ratio >= 0.7 ? 'pass' : 'fail',
      explanation:
        ratio === null
          ? '岗位分类证据不足，方向待确认。'
          : ratio >= 0.7
            ? '岗位方向与目标分类一致。'
            : '岗位大类或明确细分方向与目标不一致，仅影响方向得分。',
      evidence: [
        {
          source: 'profile',
          path: '/targetRoles',
          summary: `目标方向：${[...targets, ...(subfamily ? [subfamily] : [])].join('、')}`.slice(
            0,
            300,
          ),
        },
        {
          source: 'job',
          path: '/title',
          summary:
            `职位方向：${input.job.jobFamily ?? ''} ${input.job.jobSubfamily ?? ''} ${input.job.title}`.slice(
              0,
              300,
            ),
        },
      ],
    });
  }
  // 2、按适用条件分配分母，岗位、地点单独展示，其余条件保留在资格组。
  const conditions = outcomes.filter(
    (item) => item.ruleId !== 'qualification.recruitment-category',
  );
  if (!conditions.length) return base;
  const groups: { dimension: ScoreComponent['dimension']; items: RuleOutcome[] }[] = [
    { dimension: 'role', items: conditions.filter((item) => item.ruleId === 'preference.role') },
    {
      dimension: 'location',
      items: conditions.filter((item) => item.ruleId === 'preference.location'),
    },
    {
      dimension: 'qualification',
      items: conditions.filter(
        (item) => !['preference.role', 'preference.location'].includes(item.ruleId),
      ),
    },
  ].filter((group) => group.items.length > 0) as {
    dimension: ScoreComponent['dimension'];
    items: RuleOutcome[];
  }[];
  let remaining = 100;
  const components = groups.map(({ dimension, items }, index): ScoreComponent => {
    const maximumScore =
      index === groups.length - 1
        ? remaining
        : Math.round((items.length / conditions.length) * 10000) / 100;
    remaining = Math.round((remaining - maximumScore) * 100) / 100;
    const passed = items.filter((item) => item.status === 'pass');
    const unknown = items.filter((item) => item.status === 'unknown');
    return {
      dimension,
      maximumScore,
      score: Math.round((passed.length / items.length) * maximumScore * 100) / 100,
      evidenceStatus: unknown.length ? 'unknown' : 'known',
      recruitmentCategory: recruitmentCategory(input.job),
      evidenceCoverage: Math.round(((items.length - unknown.length) / items.length) * 100),
      matchedEvidence: passed.flatMap((item) => item.evidence),
      missingEvidence: items
        .filter((item) => item.status === 'fail')
        .map((item) => item.explanation),
      uncertainties: unknown.map((item) => item.explanation),
    };
  });
  // 3、总分由规则分项合计，岗位未知标暂定，但岗位不匹配不能覆盖既有硬过滤结论。
  return {
    ruleOutcomes: outcomes,
    components,
    totalScore: Math.round(components.reduce((sum, item) => sum + item.score, 0) * 100) / 100,
    filterStatus:
      base.filterStatus === 'eligible' && outcomes.some((item) => item.status === 'unknown')
        ? 'uncertain'
        : base.filterStatus,
  };
}
