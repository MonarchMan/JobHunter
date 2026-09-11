import type {
  DeterministicMatchInput,
  DeterministicMatchOutput,
  MatchingEvidence,
  ScoreComponent,
} from './model.js';
import type { MatchRuleset } from './rulesets.js';
import { evaluateEvidenceEligibility } from './evidence-eligibility.js';
import { recruitmentCategory } from './recruitment-requirements.js';
import { roleRatio } from './recruitment-scoring.js';
import { candidateSkillFacts, jobSkillGroups, skillCoverage } from './skill-evidence.js';
import { practiceEvidence } from './practice-evidence.js';

/** v3 保留顶层权重，只替换语义和证据计算；不改变任何历史规则路径。 */
export function calculateEvidenceMatch(
  input: DeterministicMatchInput,
  ruleset: MatchRuleset,
): DeterministicMatchOutput {
  // 1. 资格与相关性独立：明确失败优先排除，缺失不能当作失败。
  const category = recruitmentCategory(input.job);
  const recoverBoundary = ruleset.engine === 'evidence-v3.1';
  const outcomes = evaluateEvidenceEligibility(input, recoverBoundary);
  const filterStatus = outcomes.some((item) => item.status === 'fail')
    ? 'excluded'
    : outcomes.some((item) => item.status === 'unknown')
      ? 'uncertain'
      : 'eligible';
  const weights = category === 'unknown' ? null : ruleset.recruitmentWeights?.[category];
  /** 统一证据长度和状态，不适用只由类别配置的零权重声明。 */
  const score = (
    dimension: ScoreComponent['dimension'],
    ratio: number | null,
    evidence: readonly MatchingEvidence[] = [],
    missing: readonly string[] = [],
  ): ScoreComponent => {
    const maximumScore = weights ? (weights[dimension] ?? 0) : dimension === 'skills' ? 100 : 0;
    return {
      dimension,
      maximumScore,
      score: Math.round(maximumScore * (ratio ?? 0) * 100) / 100,
      recruitmentCategory: category,
      evidenceStatus: maximumScore === 0 ? 'not_applicable' : ratio === null ? 'unknown' : 'known',
      matchedEvidence: [
        ...new Map(
          evidence.map((item) => [
            `${item.path}:${item.summary}`,
            { ...item, summary: item.summary.slice(0, 300) },
          ]),
        ).values(),
      ],
      missingEvidence: [...missing],
      uncertainties:
        ratio === null && maximumScore > 0
          ? ['缺少可可靠判断的正向证据；未确认不等于不具备。']
          : [],
    };
  };
  if (!weights)
    return {
      filterStatus,
      ruleOutcomes: outcomes,
      totalScore: 0,
      components: [score('skills', null, [], ['招聘类别待确认'])],
    };
  // 2. 技能要求组和候选来源共享语义；实际使用与自述不互相重复加分。
  const groups = jobSkillGroups(input, recoverBoundary);
  const skills = skillCoverage(
    groups,
    candidateSkillFacts(
      input.profile,
      groups.flatMap((group) => group.skills),
    ),
  );
  const work = practiceEvidence(input, groups, 'experience', recoverBoundary);
  const projects = practiceEvidence(input, groups, 'projects', recoverBoundary);
  const role = roleRatio(
    input.profile.targetRoles,
    input.profile.matchingConstraints?.targetSubfamily ?? null,
    input.job,
  );
  const domains = [
    ...(input.understanding?.domains.map((item) => item.value) ?? []),
    ...(input.company.industry ? [input.company.industry] : []),
  ];
  const industry =
    input.profile.domains.length && domains.length
      ? Number(
          input.profile.domains.some((item) =>
            domains.some(
              (domain) =>
                domain.toLowerCase().includes(item.toLowerCase()) ||
                item.toLowerCase().includes(domain.toLowerCase()),
            ),
          ),
        )
      : null;
  const location = outcomes.find((item) => item.ruleId === 'preference.location');
  const components = [
    score('skills', skills.ratio, skills.evidence, skills.missing),
    score('experience', work.ratio, work.evidence, work.missing),
    score('projects', projects.ratio, projects.evidence, projects.missing),
    score('role', role, [
      {
        source: 'profile',
        path: '/targetRoles',
        summary: `目标方向：${input.profile.targetRoles.join('、')}`,
      },
      { source: 'job', path: '/title', summary: `职位方向：${input.job.title}` },
    ]),
    score(
      'industry',
      industry,
      industry === null
        ? []
        : [{ source: 'profile', path: '/domains', summary: input.profile.domains.join('、') }],
    ),
    score(
      'location',
      location?.status === 'unknown' || !location ? null : Number(location.status === 'pass'),
      location?.evidence ?? [],
    ),
  ];
  // 3. “经验不限”只影响资格，不撤销经历份额；不做 v2 的权重重分配。
  return {
    filterStatus,
    ruleOutcomes: outcomes,
    components,
    totalScore: Math.min(
      100,
      Math.round(components.reduce((sum, item) => sum + item.score, 0) * 100) / 100,
    ),
  };
}
