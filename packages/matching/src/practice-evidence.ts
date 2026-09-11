import type { DeterministicMatchInput, MatchingEvidence } from './model.js';
import {
  containsSkill,
  evidenceSentences,
  skillCoverage,
  skillFacts,
  type SkillRequirementGroup,
} from './skill-evidence.js';
import { isNonEvidence, requirementStatements } from './requirement-language.js';
import { recruitmentCategory } from './recruitment-requirements.js';

/** 职责对象词典属于 v3 政策，不根据数字数量或形容词评价贡献。 */
const responsibilities: Readonly<Record<string, readonly string[]>> = {
  接口服务: ['接口', 'api', 'restful'],
  前端界面: ['前端', '页面', '组件', '界面'],
  数据处理: ['数据清洗', '数据处理', 'etl', '数据管道'],
  数据分析: ['数据分析', '数据指标', '报表'],
  模型训练: ['模型训练', '微调', '训练模型'],
  检索系统: ['检索', 'rag', '搜索系统'],
  质量测试: ['自动化测试', '测试用例', '质量保障'],
  运维部署: ['运维', '监控', '容器部署'],
  产品需求: ['需求分析', '需求文档', '产品需求', 'prd'],
  用户研究: ['用户研究', '用户访谈', '用户调研'],
  原型设计: ['原型', '交互设计'],
  内容运营: ['内容运营', '内容策划'],
  活动运营: ['活动运营', '活动策划'],
  客户拓展: ['客户开发', '客户拓展', '商务谈判'],
};

/** 提取已识别的职责对象，避免用通用“负责”单独创造贡献。 */
function dutyKeys(text: string): string[] {
  return Object.entries(responsibilities)
    .filter(([, terms]) => terms.some((term) => containsSkill(text, term)))
    .map(([key]) => key);
}

/** 实践分项保留缺失份额；相关性与贡献都有来源证据，不累加重复条目。 */
export function practiceEvidence(
  input: DeterministicMatchInput,
  groups: readonly SkillRequirementGroup[],
  kind: 'experience' | 'projects',
  recoverBoundary = false,
): { ratio: number | null; evidence: MatchingEvidence[]; missing: string[] } {
  // 1. 从职位原文提取职责；识别不到职责时只给有证据的技能份额，不伪造满分。
  const duties = new Map<string, MatchingEvidence>();
  for (const node of requirementStatements(input.job, recoverBoundary))
    for (const sentence of evidenceSentences(node.text)) {
      if (isNonEvidence(sentence) || /不要求|无需/u.test(sentence)) continue;
      for (const key of dutyKeys(sentence))
        duties.set(key, {
          source: 'job',
          path: node.path,
          summary: `职责：${sentence}`.slice(0, 300),
        });
    }
  const work = input.profile.workExperience.map((item, index) => ({
    title: item.title,
    lines: item.highlights,
    path: `/workExperience/${String(index)}`,
  }));
  const projects = input.profile.projects.map((item, index) => ({
    title: `${item.name} ${item.role ?? ''}`,
    lines: item.highlights,
    path: `/projects/${String(index)}`,
  }));
  const entries =
    kind === 'experience'
      ? work
      : [...projects, ...(recruitmentCategory(input.job) === 'internship' ? work : [])];
  // 2. 每条实践独立匹配，标题仅作自述；职责与交付必须在同一正向原文片段关联。
  const ranked = entries
    .map((entry) => {
      const extra = groups.flatMap((group) => group.skills);
      const skills = skillCoverage(groups, [
        ...skillFacts(entry.title, `${entry.path}/title`, false, extra),
        ...skillFacts(entry.lines.join('；'), `${entry.path}/highlights`, true, extra),
      ]);
      const evidence = [...skills.evidence];
      const contributions = new Map<string, number>();
      for (const [index, line] of entry.lines.entries())
        for (const sentence of evidenceSentences(line)) {
          if (isNonEvidence(sentence)) continue;
          const owned = /负责|主导|独立完成|独立实现|承担|牵头/u.test(sentence);
          const acted =
            owned || /参与|协助|使用|实现|开发|设计|编写|维护|构建|调研/u.test(sentence);
          if (!acted) continue;
          const delivery = /上线|交付|部署|通过.{0,12}(?:测试|验收)|验证|发布/u.test(sentence);
          for (const key of dutyKeys(sentence).filter((key) => duties.has(key))) {
            contributions.set(
              key,
              Math.max(contributions.get(key) ?? 0, owned ? (delivery ? 1 : 0.7) : 0.4),
            );
            evidence.push({
              source: 'profile',
              path: `${entry.path}/highlights/${String(index)}`,
              summary:
                `${key}：${owned ? '负责' : '参与'}${owned && delivery ? '并交付/验证' : ''}；${sentence}`.slice(
                  0,
                  300,
                ),
            });
            const required = duties.get(key);
            if (required) evidence.push(required);
          }
        }
      // 3. 缺失的职责/贡献不按剩余维度归一；无信号为未知，有信号才计算已证实分。
      const related = duties.size ? contributions.size / duties.size : 0;
      const contribution = duties.size
        ? [...contributions.values()].reduce((sum, value) => sum + value, 0) / duties.size
        : 0;
      return {
        ratio:
          skills.ratio === null && !contributions.size
            ? null
            : (skills.ratio ?? 0) * 0.5 + related * 0.3 + contribution * 0.2,
        evidence,
        missing: [
          ...skills.missing,
          ...(!duties.size
            ? ['职位职责尚未可靠识别，职责与贡献份额不补分。']
            : [...duties.keys()]
                .filter((key) => !contributions.has(key))
                .map((key) => `未找到相关职责与贡献证据：${key}`)),
        ],
      };
    })
    .sort(
      (a, b) =>
        (b.ratio ?? -1) - (a.ratio ?? -1) ||
        JSON.stringify(a.evidence).localeCompare(JSON.stringify(b.evidence)),
    );
  return ranked[0] ?? { ratio: null, evidence: [], missing: ['没有可用的经历/项目证据。'] };
}
