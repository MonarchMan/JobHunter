import type {
  DeterministicMatchInput,
  DeterministicMatchOutput,
  MatchingEvidence,
  RuleOutcome,
  ScoreComponent,
} from './model.js';
import { evaluateEligibility } from './rules.js';
import { matchRulesetV1, weightFor, type MatchRuleset } from './rulesets.js';

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function normalized(value: string): string {
  return value.toLocaleLowerCase().replaceAll(/[\s\p{P}\p{S}]+/gu, '');
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function includesText(container: string, value: string): boolean {
  const left = normalized(container);
  const right = normalized(value);
  return right.length > 0 && (left.includes(right) || right.includes(left));
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function component(input: {
  readonly dimension: ScoreComponent['dimension'];
  readonly ratio: number;
  readonly ruleset: MatchRuleset;
  readonly matchedEvidence?: readonly MatchingEvidence[];
  readonly missingEvidence?: readonly string[];
  readonly uncertainties?: readonly string[];
}): ScoreComponent {
  const maximumScore = weightFor(input.ruleset, input.dimension);
  return {
    dimension: input.dimension,
    score: rounded(Math.max(0, Math.min(1, input.ratio)) * maximumScore),
    maximumScore,
    matchedEvidence: [...(input.matchedEvidence ?? [])],
    missingEvidence: [...(input.missingEvidence ?? [])],
    uncertainties: [...(input.uncertainties ?? [])],
  };
}

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function skills(input: DeterministicMatchInput, ruleset: MatchRuleset): ScoreComponent {
  const candidateSkills = input.profile.skills;
  if (candidateSkills.length === 0) {
    return component({
      dimension: 'skills',
      ratio: 0,
      ruleset,
      missingEvidence: ['/skills'],
      uncertainties: ['候选人画像没有技能事实。'],
    });
  }
  const required = input.understanding?.requiredSkills.map((skill) => skill.value) ?? [];
  const jobText = `${input.job.title}\n${input.job.description}`;
  const targets = required.length > 0 ? required : candidateSkills.map((skill) => skill.name);
  const matched = targets.filter(
    (target) =>
      candidateSkills.some((skill) => includesText(skill.name, target)) &&
      (required.length > 0 || includesText(jobText, target)),
  );
  return component({
    dimension: 'skills',
    ratio: targets.length === 0 ? 0 : matched.length / targets.length,
    ruleset,
    matchedEvidence: matched.map((value) => ({
      source: required.length > 0 ? 'enrichment' : 'job',
      path: required.length > 0 ? '/requiredSkills' : '/description',
      summary: `技能匹配：${value}`,
    })),
    missingEvidence: targets.filter((target) => !matched.includes(target)),
    uncertainties: required.length === 0 ? ['未使用语义增强，技能分数来自职位文本关键词。'] : [],
  });
}

function experience(input: DeterministicMatchInput, ruleset: MatchRuleset): ScoreComponent {
  const years = input.profile.yearsOfExperience;
  const minimum = input.understanding?.minimumYearsExperience?.value ?? null;
  if (years === null || minimum === null) {
    return component({
      dimension: 'experience',
      ratio: 0.5,
      ruleset,
      missingEvidence: [years === null ? '/yearsOfExperience' : '/minimumYearsExperience'],
      uncertainties: ['经验年限证据不完整，使用中性分。'],
    });
  }
  const ratio = minimum === 0 ? 1 : Math.min(1, years / minimum);
  return component({
    dimension: 'experience',
    ratio,
    ruleset,
    matchedEvidence: [
      { source: 'profile', path: '/yearsOfExperience', summary: `候选人经验：${String(years)} 年` },
      {
        source: 'enrichment',
        path: '/minimumYearsExperience',
        summary: `职位要求：${String(minimum)} 年`,
      },
    ],
  });
}

function role(input: DeterministicMatchInput, ruleset: MatchRuleset): ScoreComponent {
  const targets = input.profile.targetRoles;
  if (targets.length === 0) {
    return component({
      dimension: 'role',
      ratio: 0,
      ruleset,
      missingEvidence: ['/targetRoles'],
      uncertainties: ['未设置目标岗位方向。'],
    });
  }
  const matched = targets.filter((target) => includesText(input.job.title, target));
  return component({
    dimension: 'role',
    ratio: matched.length > 0 ? 1 : 0,
    ruleset,
    matchedEvidence: matched.map((target) => ({
      source: 'profile',
      path: '/targetRoles',
      summary: `岗位方向匹配：${target}`,
    })),
    missingEvidence: matched.length === 0 ? targets : [],
  });
}

function industry(input: DeterministicMatchInput, ruleset: MatchRuleset): ScoreComponent {
  const profileDomains = input.profile.domains;
  const jobDomains = [
    ...(input.understanding?.domains.map((domain) => domain.value) ?? []),
    ...(input.company.industry ? [input.company.industry] : []),
  ];
  if (profileDomains.length === 0 || jobDomains.length === 0) {
    return component({
      dimension: 'industry',
      ratio: 0.5,
      ruleset,
      missingEvidence: [profileDomains.length === 0 ? '/domains' : '/company/industry'],
      uncertainties: ['行业证据不完整，使用中性分。'],
    });
  }
  const matched = profileDomains.filter((profileDomain) =>
    jobDomains.some((jobDomain) => includesText(jobDomain, profileDomain)),
  );
  return component({
    dimension: 'industry',
    ratio: matched.length > 0 ? 1 : 0,
    ruleset,
    matchedEvidence: matched.map((domain) => ({
      source: 'profile',
      path: '/domains',
      summary: `领域匹配：${domain}`,
    })),
    missingEvidence: matched.length === 0 ? profileDomains : [],
  });
}

function location(input: DeterministicMatchInput, ruleset: MatchRuleset): ScoreComponent {
  const preferred = input.profile.preferences.locations;
  if (preferred.length === 0) {
    return component({
      dimension: 'location',
      ratio: 1,
      ruleset,
      matchedEvidence: [
        { source: 'preference', path: '/preferences/locations', summary: '未限制工作地点。' },
      ],
    });
  }
  if (input.job.locations.length === 0) {
    return component({
      dimension: 'location',
      ratio: 0.5,
      ruleset,
      missingEvidence: ['/job/locations'],
      uncertainties: ['职位地点未知，使用中性分。'],
    });
  }
  const matched = preferred.filter((preference) =>
    input.job.locations.some((jobLocation) => includesText(jobLocation, preference)),
  );
  return component({
    dimension: 'location',
    ratio: matched.length > 0 ? 1 : 0,
    ruleset,
    matchedEvidence: matched.map((place) => ({
      source: 'preference',
      path: '/preferences/locations',
      summary: `地点匹配：${place}`,
    })),
    missingEvidence: matched.length === 0 ? preferred : [],
  });
}

function filterStatus(outcomes: readonly RuleOutcome[]): DeterministicMatchOutput['filterStatus'] {
  if (outcomes.some((outcome) => outcome.status === 'fail')) return 'excluded';
  if (outcomes.some((outcome) => outcome.status === 'unknown')) return 'uncertain';
  return 'eligible';
}

/** 计算各维度得分、总分和过滤状态。 */
export function calculateDeterministicMatch(
  // 1、计算技能/经验/角色/行业/地点分项；2、汇总权重；3、根据资格结果确定过滤状态。
  input: DeterministicMatchInput,
  ruleset: MatchRuleset = matchRulesetV1,
): DeterministicMatchOutput {
  const ruleOutcomes = [...evaluateEligibility(input)];
  const components = [
    skills(input, ruleset),
    experience(input, ruleset),
    role(input, ruleset),
    industry(input, ruleset),
    location(input, ruleset),
  ];
  return {
    filterStatus: filterStatus(ruleOutcomes),
    ruleOutcomes,
    components,
    totalScore: rounded(components.reduce((sum, item) => sum + item.score, 0)),
  };
}
