import type { CandidateProfileData } from '@jobhunter/domain';
import type { DeterministicMatchInput, MatchingEvidence } from './model.js';
import { skillAliases } from './recruitment-scoring.js';
import {
  isNonEvidence,
  requirementStatements,
  type RequirementNode,
} from './requirement-language.js';

/** 扩展词典作为 v3 政策冻结，不修改 v2 的别名集合。 */
const aliases: Readonly<Record<string, readonly string[]>> = {
  ...skillAliases,
  Kotlin: ['kotlin'],
  Swift: ['swift'],
  Rust: ['rust'],
  PHP: ['php'],
  C语言: ['c语言', 'c language'],
  HTML: ['html', 'html5'],
  CSS: ['css', 'css3'],
  TensorFlow: ['tensorflow'],
  Android: ['android', '安卓'],
  iOS: ['ios'],
  Spark: ['spark'],
  Hadoop: ['hadoop'],
  Elasticsearch: ['elasticsearch', 'elastic search'],
  'A/B测试': ['a/b测试', 'ab测试', 'a/b test'],
  原型设计: ['原型设计', '产品原型'],
  需求文档: ['需求文档', 'prd'],
  用户增长: ['用户增长', '拉新'],
  SEO: ['seo', '搜索引擎优化'],
  广告投放: ['广告投放'],
  商务谈判: ['商务谈判'],
};

/** 技能边界排除 JavaScript 对 Java 等子串命中，不改写原文。 */
export function containsSkill(text: string, value: string): boolean {
  const escaped = value.trim().replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'iu').test(text);
}

/** 归一词典别名；未收录的结构化技能仍保留规范键。 */
export function canonicalSkill(value: string): string {
  return (
    Object.entries(aliases).find(([key, values]) =>
      [key, ...values].some((item) => item.toLowerCase() === value.trim().toLowerCase()),
    )?.[0] ?? value.trim().toLowerCase()
  );
}

/** 提取已知技能和已验证增强提供的词汇，不推测未识别要求。 */
function skillsIn(text: string, extra: readonly string[] = []): string[] {
  return [
    ...new Set([
      ...Object.entries(aliases)
        .filter(([key, values]) => [key, ...values].some((item) => containsSkill(text, item)))
        .map(([key]) => key),
      ...extra.filter((item) => containsSkill(text, item)).map(canonicalSkill),
    ]),
  ];
}

/** 一组要求内部任选其一，多个组同时计入分母。 */
export interface SkillRequirementGroup {
  readonly skills: readonly string[];
  readonly required: boolean;
  readonly evidence: MatchingEvidence;
}

/** 正向能力记录其来源和证据强度，同技能只取最强证据。 */
export interface SkillFact {
  readonly key: string;
  readonly strength: number;
  readonly evidence: MatchingEvidence;
}

/** 分句仅影响证据作用域，原文片段仍可定位。 */
export function evidenceSentences(text: string): string[] {
  return text
    .split(/[\n；;。，,]|但是|但|而且|并且|且/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 工作/项目有实际动作才标为使用证据，标题或技能堆砌仅作自述。 */
export function skillFacts(
  text: string,
  path: string,
  practical: boolean,
  extra: readonly string[] = [],
): SkillFact[] {
  // 1. 否定、计划与正在学习不作为已掌握证据；局部冲突宁可保留未知。
  return evidenceSentences(text).flatMap((sentence) => {
    if (isNonEvidence(sentence)) return [];
    const used =
      practical &&
      /使用|采用|基于|实现|开发|构建|维护|部署|编写|接入|排查|优化|设计|参与|负责|交付|验证|using|implemented|built/iu.test(
        sentence,
      );
    // 2. 仅自述能力为 0.8；实践动作证据为 1，不因重复来源加分。
    return skillsIn(sentence, extra).map((key) => ({
      key,
      strength: used ? 1 : 0.8,
      evidence: {
        source: 'profile' as const,
        path,
        summary: `${used ? '实际使用' : '自述能力'}：${sentence}`.slice(0, 300),
      },
    }));
  });
}

/** 汇总简历各章节的技能证据，同时保留否定/计划的原文由评分器解释。 */
export function candidateSkillFacts(
  profile: CandidateProfileData,
  extra: readonly string[],
): SkillFact[] {
  // 1. 结构化技能可能没有证据正文，仍是候选人的能力自述，不升级为实践。
  const structured = profile.skills.flatMap((item, index) => {
    const quotes = item.evidence.flatMap((evidence) => (evidence.quote ? [evidence.quote] : []));
    if (isNonEvidence(item.name) || (quotes.length && quotes.every(isNonEvidence))) return [];
    return [
      {
        key: canonicalSkill(item.name),
        strength: 0.8,
        evidence: {
          source: 'profile' as const,
          path: `/skills/${String(index)}`,
          summary: `自述能力：${item.name}`.slice(0, 300),
        },
      },
    ];
  });
  // 2. 技能栏缺失不阻止从工作/项目中找到直接使用事实。
  return [
    ...structured,
    ...skillFacts(profile.professionalSkills ?? '', '/professionalSkills', false, extra),
    ...profile.workExperience.flatMap((item, index) => [
      ...skillFacts(item.title, `/workExperience/${String(index)}/title`, false, extra),
      ...skillFacts(
        item.highlights.join('；'),
        `/workExperience/${String(index)}/highlights`,
        true,
        extra,
      ),
    ]),
    ...profile.projects.flatMap((item, index) => [
      ...skillFacts(
        `${item.name}；${item.role ?? ''}`,
        `/projects/${String(index)}/name`,
        false,
        extra,
      ),
      ...skillFacts(
        item.highlights.join('；'),
        `/projects/${String(index)}/highlights`,
        true,
        extra,
      ),
    ]),
  ];
}

/** 解析技能组，语义增强只补充词汇与证据，原文明示的任选/豁免优先。 */
export function jobSkillGroups(
  input: DeterministicMatchInput,
  recoverBoundary = false,
): SkillRequirementGroup[] {
  const enhanced = [
    ...(input.understanding?.requiredSkills ?? []),
    ...(input.understanding?.preferredSkills ?? []),
  ];
  const extra = enhanced
    .filter((item) =>
      item.evidence.some(
        (evidence) =>
          (input.job[evidence.field] ?? '').includes(evidence.quote) &&
          containsSkill(evidence.quote, item.value),
      ),
    )
    .map((item) => item.value);
  const groups: SkillRequirementGroup[] = [];
  /** 递归读取技能条件，不能将一个 or 组展开为多个必需项。 */
  const visit = (node: RequirementNode): void => {
    if (node.kind === 'all') {
      node.children.forEach(visit);
      return;
    }
    if (node.kind === 'atom' && (node.mode === 'waived' || isNonEvidence(node.text))) return;
    if (node.kind === 'any' && /^(?:要求)?\s*(?:不要求|无需|不必|尚未|计划)/u.test(node.text))
      return;
    const skills = skillsIn(node.text, extra);
    if (!skills.length) return;
    const required =
      !/优先|加分|preferred|nice.to.have/iu.test(node.text) || /必须|必需/u.test(node.text);
    const evidence: MatchingEvidence = {
      source: 'job',
      path: node.path,
      summary: `要求：${node.text}`.slice(0, 300),
    };
    if (node.kind === 'any' || /任一|任选|至少.{0,2}一种/u.test(node.text))
      groups.push({ skills, required, evidence });
    else for (const skill of skills) groups.push({ skills: [skill], required, evidence });
  };
  // 1. 增强只补充有原文支撑的词汇；完整条款决定任选、优先和豁免，不相信模型标签。
  for (const node of requirementStatements(input.job, recoverBoundary)) visit(node);
  // 2. 去掉重复技能组，必需条件覆盖同组优先项，不累计正文重复次数。
  const unique = new Map<string, SkillRequirementGroup>();
  for (const group of groups) {
    const key = [...group.skills].sort().join('|');
    if (!unique.has(key) || group.required) unique.set(key, group);
  }
  return [...unique.values()];
}

/** 要求组的覆盖率按必需 3、优先 1 加权；同一技能不叠加多处证据。 */
export function skillCoverage(
  groups: readonly SkillRequirementGroup[],
  facts: readonly SkillFact[],
): { ratio: number | null; evidence: MatchingEvidence[]; missing: string[] } {
  if (!groups.length)
    return { ratio: null, evidence: [], missing: ['未识别到可可靠计算的技能要求。'] };
  const evidence: MatchingEvidence[] = [];
  const missing: string[] = [];
  let numerator = 0;
  let denominator = 0;
  for (const group of groups) {
    const best = facts
      .filter((item) => group.skills.includes(item.key))
      .toSorted(
        (a, b) => b.strength - a.strength || a.evidence.path.localeCompare(b.evidence.path),
      )[0];
    const weight = group.required ? 3 : 1;
    denominator += weight;
    numerator += weight * (best?.strength ?? 0);
    if (best) evidence.push(group.evidence, best.evidence);
    else missing.push(`未找到正向证据：${group.skills.join(' 或 ')}`);
  }
  return {
    ratio: facts.length ? numerator / denominator : null,
    evidence: [...new Map(evidence.map((item) => [`${item.path}:${item.summary}`, item])).values()],
    missing,
  };
}
