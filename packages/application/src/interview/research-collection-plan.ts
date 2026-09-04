import { experienceResearchBriefSchema, type ExperienceResearchBrief } from '@jobhunter/domain';
import type { ExternalResearchCollectionPlan } from '../ports/external-research.js';

/** 应用服务使用的稳定配置或常量。 */
export const communityBrowserCollectionPlanVersion = 'community-browser-collection@v2' as const;

/** 规范化查询文本，避免不同空白造成重复搜索。 */
function searchText(value: string): string {
  return value.normalize('NFKC').replaceAll(/\s+/gu, ' ').trim();
}

/** 对搜索词去重并排序，保证计划可复现。 */
function stableSearchTerms(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(searchText))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

const chineseGenericRoleSuffix =
  /(?:高级|资深|初级|中级|实习生|实习|工程师|研究员|专家|顾问|负责人|岗位|方向|应用研发|应用开发|研发|开发|算法|应用)$/u;
const englishGenericRoleWords = new Set([
  'algorithm',
  'application',
  'developer',
  'development',
  'engineer',
  'engineering',
  'intern',
  'junior',
  'lead',
  'senior',
  'specialist',
]);

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function roleRelevanceTerms(role: string): readonly string[] {
  const terms = [role];
  let core = role;
  while (chineseGenericRoleSuffix.test(core)) {
    core = core.replace(chineseGenericRoleSuffix, '').trim();
  }
  if (core.length >= 2 && core !== role) terms.push(core);

  const englishCore = role
    .toLocaleLowerCase('en-US')
    .split(/[^\p{L}\p{N}+#.]+/u)
    .filter((term) => term.length >= 2 && !englishGenericRoleWords.has(term));
  terms.push(...englishCore);
  return terms;
}

/** 从岗位、公司和允许域名生成受限的外部研究搜索计划。 */
export function createCommunityResearchCollectionPlan(
  briefValue: ExperienceResearchBrief,
  maximumSearches: number,
): ExternalResearchCollectionPlan {
  // 1、校验简报和搜索上限；2、优先生成站内查询；3、补充通用查询并截断；4、生成相关性词表。
  const brief = experienceResearchBriefSchema.parse(briefValue);
  if (!Number.isSafeInteger(maximumSearches) || maximumSearches < 1 || maximumSearches > 20) {
    throw new TypeError('Research collection search limit is invalid.');
  }

  const roles = stableSearchTerms(brief.targetRoles);
  const companies = stableSearchTerms(brief.companies);
  const allowedDomains = stableSearchTerms(brief.allowedDomains);
  const suffix =
    brief.language === 'en' ? 'interview experience technical questions' : '面经 面试 技术问题';
  const priorityCandidates: string[] = [];
  for (const domain of allowedDomains) {
    for (const role of roles) {
      priorityCandidates.push(`site:${domain} ${role} ${suffix}`);
    }
  }

  const genericCandidates: string[] = [];
  for (const company of companies) {
    for (const role of roles) genericCandidates.push(`${company} ${role} ${suffix}`);
  }
  for (const role of roles) genericCandidates.push(`${role} ${suffix}`);
  if (roles.length > 1) {
    genericCandidates.push(
      brief.language === 'en'
        ? `${roles.join(' ')} project deep dive system design interview`
        : `${roles.join(' ')} 项目追问 系统设计 面经`,
    );
  }

  const priorityQueries = [...new Set(priorityCandidates.map(searchText))];
  const candidates = [...priorityQueries, ...genericCandidates];
  const queries = [...new Set(candidates.map(searchText))].slice(0, maximumSearches);
  if (queries.length === 0) throw new TypeError('Research collection plan has no search query.');
  const relevanceTerms = [
    ...new Set(
      roles
        .flatMap(roleRelevanceTerms)
        .map(searchText)
        .filter((term) => term.length >= 2),
    ),
  ];
  if (relevanceTerms.length === 0) {
    throw new TypeError('Research collection plan has no relevance term.');
  }
  return {
    version: communityBrowserCollectionPlanVersion,
    queries,
    priorityQueryCount: Math.min(priorityQueries.length, queries.length),
    relevanceTerms,
    maximumSources: brief.maxSources,
  };
}
