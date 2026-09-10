import { normalizeJobTaxonomy, type NormalizedJob } from '@jobhunter/domain';
import type {
  DeterministicMatchInput,
  DeterministicMatchOutput,
  MatchingEvidence,
  ScoreComponent,
} from './model.js';
import type { MatchRuleset } from './rulesets.js';
import {
  evaluateRecruitmentEligibility,
  recruitmentCategory,
  requirementClauses,
  type RecruitmentCategory,
} from './recruitment-requirements.js';

/** v2 的技能别名是规则版本的一部分，短拉丁词使用边界防止 Java 命中 JavaScript。 */
export const skillAliases: Readonly<Record<string, readonly string[]>> = {
  TypeScript: ['typescript', 'ts'],
  JavaScript: ['javascript', 'js'],
  Java: ['java'],
  Python: ['python'],
  'C++': ['c++'],
  'C#': ['c#'],
  Go: ['golang', 'go'],
  React: ['react', 'reactjs'],
  Vue: ['vue', 'vuejs'],
  Node: ['node.js', 'nodejs'],
  SQL: ['sql'],
  MySQL: ['mysql'],
  PostgreSQL: ['postgresql', 'postgres'],
  Redis: ['redis'],
  Docker: ['docker'],
  Kubernetes: ['kubernetes', 'k8s'],
  Linux: ['linux'],
  Git: ['git'],
  Spring: ['spring', 'springboot', 'spring boot'],
  PyTorch: ['pytorch'],
  RAG: ['rag', '检索增强生成'],
  LLM: ['llm', '大语言模型', '大模型'],
  Agent: ['agent', '智能体'],
  Excel: ['excel'],
  Figma: ['figma'],
  Axure: ['axure'],
  数据分析: ['数据分析'],
  用户研究: ['用户研究'],
  需求分析: ['需求分析'],
  内容运营: ['内容运营'],
  活动运营: ['活动运营'],
  客户开发: ['客户开发'],
};

/** 规范文本仅用于比较，不改写证据原文。 */
function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, ' ');
}

/** 技能别名匹配保留拉丁标识符边界，中文词按完整词组匹配。 */
function contains(text: string, term: string): boolean {
  const escaped = normalize(term).replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'iu').test(text);
}

/** 将一个技能名称转换为稳定键，未收录词保持原义。 */
function skillKey(value: string): string {
  return (
    Object.entries(skillAliases).find(
      ([key, aliases]) =>
        normalize(key) === normalize(value) ||
        aliases.some((alias) => normalize(alias) === normalize(value)),
    )?.[0] ?? normalize(value)
  );
}

/** 根据固定词典提取原文技能，不以候选人技能数量作为职位要求分母。 */
function extractSkills(text: string): string[] {
  return Object.entries(skillAliases)
    .filter(([key, aliases]) => [key, ...aliases].some((alias) => contains(text, alias)))
    .map(([key]) => key);
}

/** 岗位要求含原文证据，required 相比 preferred 使用三倍权重。 */
interface SkillTarget {
  readonly key: string;
  readonly required: boolean;
  readonly evidence: MatchingEvidence;
}

/** 有语义增强时沿用已校验事实，否则从冻结职位正文提取关键词。 */
function skillTargets(input: DeterministicMatchInput): SkillTarget[] {
  // 1. 保留原始证据；纯规则模式明确标注为关键词要求，不冒充语义理解。
  const enhanced = input.understanding;
  const values: SkillTarget[] = enhanced
    ? [
        ...enhanced.requiredSkills.map((skill) => ({ skill, required: true })),
        ...enhanced.preferredSkills.map((skill) => ({ skill, required: false })),
      ].map(({ skill, required }) => ({
        key: skillKey(skill.value),
        required,
        evidence: {
          source: 'enrichment',
          path: required ? '/requiredSkills' : '/preferredSkills',
          summary: `${skill.value}：${skill.evidence.map((item) => item.quote).join('；')}`,
        },
      }))
    : requirementClauses(input.job).flatMap((clause) =>
        extractSkills(clause.text).map((key) => ({
          key,
          required: !clause.preferred,
          evidence: {
            source: 'job' as const,
            path: clause.path,
            summary: `关键词 ${key}：${clause.text}`,
          },
        })),
      );
  // 2. 同一技能只出现一次，必需要求覆盖同名优先项。
  const unique = new Map<string, SkillTarget>();
  for (const value of values)
    if (!unique.has(value.key) || value.required) unique.set(value.key, value);
  return [...unique.values()];
}

/** 使用业务分类计算方向相关性，而非要求标题含“研发”等大类字样。 */
export function roleRatio(
  targets: readonly string[],
  subfamily: string | null,
  job: NormalizedJob,
): number | null {
  // 1. 来源显式大类优先；二级分类缺失时从标题回退。
  const explicit = normalizeJobTaxonomy(job.jobFamily);
  const title = normalizeJobTaxonomy(job.title);
  const family = explicit.jobFamily === '其他' ? title.jobFamily : explicit.jobFamily;
  const sub = normalizeJobTaxonomy(job.jobSubfamily ?? job.title).jobSubfamily;
  if (family === '其他' || targets.length === 0) return null;
  // 2. 大类相同有基础分；细分方向一致给满分，不同细分保留较低基础分。
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

/** 保存分项的证据状态；未知与不适用均不伪造半分。 */
function score(
  dimension: ScoreComponent['dimension'],
  maximumScore: number,
  category: RecruitmentCategory,
  ratio: number | null,
  evidence: readonly MatchingEvidence[],
  missing: readonly string[] = [],
  notApplicable = false,
): ScoreComponent {
  return {
    dimension,
    maximumScore,
    score: Math.round((ratio ?? 0) * maximumScore * 100) / 100,
    evidenceStatus:
      notApplicable || maximumScore === 0 ? 'not_applicable' : ratio === null ? 'unknown' : 'known',
    recruitmentCategory: category,
    matchedEvidence: evidence.map((item) => ({ ...item, summary: item.summary.slice(0, 300) })),
    missingEvidence: [...missing],
    uncertainties:
      ratio === null && !notApplicable && maximumScore > 0
        ? ['证据不足；此项暂不贡献已证实分，保留权重等待补充。']
        : [],
  };
}

/** 经历相关性取最佳一条，不按数量、字数或重复技能累计加分。 */
function practice(
  input: DeterministicMatchInput,
  targets: readonly SkillTarget[],
  kind: 'experience' | 'projects',
  category: RecruitmentCategory,
): { ratio: number | null; evidence: MatchingEvidence[] } {
  // 1. 社招/校招工作经历独立；实习允许工作/实习经历作为实践证据。
  const entries =
    kind === 'experience'
      ? input.profile.workExperience.map((item, index) => ({
          text: `${item.title} ${item.highlights.join(' ')}`,
          path: `/workExperience/${String(index)}`,
        }))
      : [
          ...input.profile.projects.map((item, index) => ({
            text: `${item.name} ${item.role ?? ''} ${item.highlights.join(' ')}`,
            path: `/projects/${String(index)}`,
          })),
          ...(category === 'internship'
            ? input.profile.workExperience.map((item, index) => ({
                text: `${item.title} ${item.highlights.join(' ')}`,
                path: `/workExperience/${String(index)}`,
              }))
            : []),
        ];
  if (!entries.length) return { ratio: null, evidence: [] };
  // 2. 要求技能覆盖与业务方向分别提供相关性信号，不因无可识别信号判定不相关。
  const total = targets.reduce((sum, item) => sum + (item.required ? 3 : 1), 0);
  const ranked = entries
    .map((entry) => {
      const extracted = new Set(extractSkills(entry.text));
      const hits = targets.filter(
        (target) => extracted.has(target.key) || contains(entry.text, target.key),
      );
      const skills = total
        ? hits.reduce((sum, item) => sum + (item.required ? 3 : 1), 0) / total
        : null;
      const role = roleRatio([entry.text], null, input.job);
      return {
        ...entry,
        ratio: skills === null ? role : role === null ? skills : skills * 0.7 + role * 0.3,
      };
    })
    .filter((entry) => entry.ratio !== null)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const best = ranked[0];
  return best
    ? {
        ratio: best.ratio,
        evidence: [{ source: 'profile', path: best.path, summary: `最佳相关实践：${best.text}` }],
      }
    : { ratio: null, evidence: [] };
}

/** 根据保存的分项计算证据完整度，旧版结果不伪造该指标。 */
export function matchEvidenceCoverage(components: readonly ScoreComponent[]): number | null {
  if (!components.length || components.some((item) => item.evidenceStatus === undefined))
    return null;
  const applicable = components.filter((item) => item.evidenceStatus !== 'not_applicable');
  const total = applicable.reduce((sum, item) => sum + item.maximumScore, 0);
  return total === 0
    ? 0
    : Math.round(
        (applicable
          .filter((item) => item.evidenceStatus === 'known')
          .reduce((sum, item) => sum + item.maximumScore, 0) /
          total) *
          100,
      );
}

/** v2 统一评分引擎：类别、资格、证据、权重的顺序固定，可离线重放。 */
export function calculateRecruitmentMatch(
  input: DeterministicMatchInput,
  ruleset: MatchRuleset,
): DeterministicMatchOutput {
  // 1. 从冻结职位选规则，未知类别不偷偷套入社招/实习权重。
  const category = recruitmentCategory(input.job);
  const outcomes = evaluateRecruitmentEligibility(input, category);
  const status = outcomes.some((item) => item.status === 'fail')
    ? 'excluded'
    : outcomes.some((item) => item.status === 'unknown')
      ? 'uncertain'
      : 'eligible';
  if (category === 'unknown')
    return {
      filterStatus: status,
      ruleOutcomes: outcomes,
      totalScore: 0,
      components: [score('skills', 100, category, null, [], ['招聘类别待确认'])],
    };
  const weights = ruleset.recruitmentWeights?.[category];
  if (!weights) throw new TypeError('Recruitment scoring requires versioned category weights.');
  // 2. 技能只按职位要求计算分母；空画像是未知，不假装不合格。
  const targets = skillTargets(input);
  const candidate = new Set([
    ...input.profile.skills.map((skill) => skillKey(skill.name)),
    ...extractSkills(input.profile.professionalSkills ?? ''),
  ]);
  const hits = targets.filter((target) => candidate.has(target.key));
  const denominator = targets.reduce((sum, item) => sum + (item.required ? 3 : 1), 0);
  const skillsRatio =
    denominator && candidate.size
      ? hits.reduce((sum, item) => sum + (item.required ? 3 : 1), 0) / denominator
      : null;
  const work = practice(input, targets, 'experience', category);
  const projects = practice(input, targets, 'projects', category);
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
            domains.some((domain) => contains(domain, item) || contains(item, domain)),
          ),
        )
      : null;
  const locationRule = outcomes.find((item) => item.ruleId === 'preference.location');
  const experienceNotRequired = requirementClauses(input.job).some(
    (clause) =>
      !clause.preferred &&
      /经验不限|不限经验|无需(?:工作)?经验|不要求(?:工作)?经验/u.test(clause.text),
  );
  let components = [
    score(
      'skills',
      weights.skills,
      category,
      skillsRatio,
      hits.map((item) => item.evidence),
      targets.filter((item) => !candidate.has(item.key)).map((item) => item.key),
    ),
    score(
      'experience',
      weights.experience,
      category,
      experienceNotRequired ? 0 : work.ratio,
      work.evidence,
      [],
      experienceNotRequired,
    ),
    score('projects', weights.projects ?? 0, category, projects.ratio, projects.evidence),
    score(
      'role',
      weights.role,
      category,
      role,
      role === null
        ? []
        : [
            {
              source: 'profile',
              path: '/targetRoles',
              summary: `方向：${input.profile.targetRoles.join('、')}；职位：${input.job.jobFamily ?? input.job.title} / ${input.job.jobSubfamily ?? ''}`,
            },
          ],
    ),
    score(
      'industry',
      weights.industry,
      category,
      industry,
      industry === null
        ? []
        : [
            {
              source: 'profile',
              path: '/domains',
              summary: `候选领域：${input.profile.domains.join('、')}；职位领域：${domains.join('、')}`,
            },
          ],
    ),
    score(
      'location',
      weights.location,
      category,
      !locationRule || locationRule.status === 'unknown'
        ? null
        : Number(locationRule.status === 'pass'),
      locationRule?.evidence ?? [],
    ),
  ];
  // 3. 只重分配明确不适用的权重；未知仍占分母，避免地点匹配即得到虚假满分。
  const applicableWeight = components
    .filter((item) => item.evidenceStatus !== 'not_applicable')
    .reduce((sum, item) => sum + item.maximumScore, 0);
  if (applicableWeight && applicableWeight !== 100)
    components = components.map((item) =>
      item.evidenceStatus === 'not_applicable'
        ? { ...item, maximumScore: 0, score: 0 }
        : {
            ...item,
            maximumScore: Math.round((item.maximumScore / applicableWeight) * 10000) / 100,
            score: Math.round((item.score / applicableWeight) * 10000) / 100,
          },
    );
  return {
    filterStatus: status,
    ruleOutcomes: outcomes,
    components,
    totalScore: Math.min(
      100,
      Math.round(components.reduce((sum, item) => sum + item.score, 0) * 100) / 100,
    ),
  };
}
