import {
  communityQuestionFingerprint,
  communityResearchBundleSchema,
  experienceResearchBriefSchema,
  normalizeCommunityQuestion,
  normalizePublicResearchUrl,
  type CommunityResearchBundle,
  type ExperienceResearchBrief,
} from '@jobhunter/domain';

/** 规范化域名后再执行允许/禁止列表匹配。 */
function normalizedDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/gu, '');
}

/** 判断主机名是否属于配置域名或其子域。 */
function matchesDomain(hostname: string, configured: string): boolean {
  const domain = normalizedDomain(configured);
  return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
}

/** 校验公开研究来源没有越过研究简报的域名边界。 */
function assertDomainPolicy(urlValue: string, brief: ExperienceResearchBrief): void {
  const hostname = new URL(urlValue).hostname.toLowerCase();
  if (
    brief.allowedDomains.length > 0 &&
    !brief.allowedDomains.some((domain) => matchesDomain(hostname, domain))
  ) {
    throw new TypeError(`Research source is outside the allowed domains: ${hostname}`);
  }
  if (brief.blockedDomains.some((domain) => matchesDomain(hostname, domain))) {
    throw new TypeError(`Research source uses a blocked domain: ${hostname}`);
  }
}

const emptyResearchResultPatterns = [
  /\b(?:live|real[ -]?time|web|online)\s+(?:search|browsing|retrieval)\s+(?:is\s+)?(?:unavailable|disabled|unsupported|inaccessible|blocked|failed)\b/u,
  /\b(?:unable|failed|could not|couldn't|cannot|can't)\s+(?:to\s+)?(?:perform|use|run|conduct)?\s*(?:live|real[ -]?time|web|online)?\s*(?:search|browse|browsing|retrieval)\b/u,
  /\b(?:unable|failed|could not|couldn't|cannot|can't)\s+(?:to\s+)?(?:search|browse|retrieve|access|find)\b.{0,80}\b(?:sources?|pages?|results?|interview (?:reports?|experiences?)|content)\b/u,
  /\b(?:no|zero)\s+(?:(?:valid|real|relevant|available|verifiable)\s+)?(?:sources?|results?|interview (?:reports?|experiences?)|findings?)\s*(?:were\s+)?(?:found|available|retrieved)?\b/u,
  /\b(?:placeholder|dummy|mock|sample)\s+(?:sources?|results?|data|content|interview (?:reports?|experiences?)|questions?|urls?)\b/u,
  /(?:实时|联网|网页|网络)(?:检索|搜索|浏览|访问)(?:功能|能力)?(?:.{0,12})(?:不可用|不支持|未启用|受限|失败|无法|不能)/u,
  /(?:无法|不能|未能|没能)(?:进行|使用|完成|执行)?(?:实时|联网|网页|网络)?(?:检索|搜索|浏览|访问)/u,
  /(?:无法|不能|未能|没能)(?:.{0,12})(?:检索|搜索|浏览|访问|查找|找到)(?:.{0,20})(?:来源|网页|面经|结果|资料|内容)/u,
  /(?:未|没有)(?:检索|搜索|查找|找到)(?:到)?(?:.{0,12})(?:来源|面经|结果|资料|内容)/u,
  /(?:无|没有)(?:可用|真实|有效|相关)?(?:来源|面经|搜索结果|检索结果|研究结果)/u,
  /(?:占位|虚构|伪造|模拟|示例)(?:来源|结果|数据|内容|面经|问题|链接)/u,
] as const;

function hasEmptyResearchResultSignal(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
  return emptyResearchResultPatterns.some((pattern) => pattern.test(normalized));
}

/** 识别文本是否像可用于准备的面试问题。 */
function looksLikeInterviewQuestion(value: string): boolean {
  const normalized = value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
  return (
    /[?？]\s*$/u.test(normalized) ||
    /(?:如何|怎么|怎样|为什么|为何|哪些|哪个|是否|能否)/u.test(normalized) ||
    /^(?:请)?(?:解释|说明|描述|设计|比较|分析|介绍|实现|谈谈)/u.test(normalized) ||
    /\b(?:how|why|what|which|when|where|who|would|could|should|can you|do you)\b/u.test(
      normalized,
    ) ||
    /^(?:please\s+)?(?:explain|describe|design|compare|analyze|implement)\b/u.test(normalized)
  );
}

/** 拒绝“检索失败”伪装成研究结果的空包。 */
function assertContainsResearchFindings(
  sources: readonly { readonly title: string }[],
  experiences: readonly {
    readonly questions: readonly {
      readonly text: string;
      readonly answerExcerpt: string | null;
    }[];
  }[],
  warnings: readonly string[],
): void {
  const hasBundleFailureContext =
    sources.some((source) => hasEmptyResearchResultSignal(source.title)) ||
    warnings.some(hasEmptyResearchResultSignal);
  if (!hasBundleFailureContext) return;

  const questions = experiences.flatMap((experience) => experience.questions);
  const containsOnlyFailureStatements = questions.every(
    (question) =>
      !looksLikeInterviewQuestion(question.text) &&
      [question.text, question.answerExcerpt].some(hasEmptyResearchResultSignal),
  );
  if (containsOnlyFailureStatements) {
    throw new TypeError('Research bundle contains no verifiable interview findings.');
  }
}

/** 校验、规范化和按来源去重外部面经研究结果。 */
export function normalizeCommunityResearchBundle(input: {
  readonly value: unknown;
  readonly brief: ExperienceResearchBrief;
  readonly expectedFingerprint: string;
}): CommunityResearchBundle {
  // 1、校验简报、Schema 和请求指纹；2、规范化来源 URL；3、按来源去重问题；4、检查配额和空结果。
  const brief = experienceResearchBriefSchema.parse(input.brief);
  const parsed = communityResearchBundleSchema.parse(input.value);
  if (parsed.requestFingerprint !== input.expectedFingerprint) {
    throw new TypeError('Research bundle request fingerprint does not match.');
  }
  if (parsed.sources.length > brief.maxSources) {
    throw new TypeError('Research bundle exceeds the source limit.');
  }

  const sources = new Map<string, (typeof parsed.sources)[number]>();
  for (const source of parsed.sources) {
    const url = normalizePublicResearchUrl(source.url);
    assertDomainPolicy(url, brief);
    const normalized = { ...source, url };
    const existing = sources.get(url);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new TypeError('Canonical research source has conflicting metadata.');
    }
    sources.set(url, normalized);
  }
  if (sources.size > brief.maxSources) throw new TypeError('Research source limit is invalid.');

  const questionCountBySource = new Map<string, number>();
  const experiences = parsed.experiences.map((experience) => {
    const sourceUrl = normalizePublicResearchUrl(experience.sourceUrl);
    assertDomainPolicy(sourceUrl, brief);
    if (!sources.has(sourceUrl)) {
      throw new TypeError('Research experience references an unknown source URL.');
    }
    const fingerprints = new Set<string>();
    const questions = experience.questions.flatMap((question) => {
      const text = normalizeCommunityQuestion(question.text);
      const fingerprint = communityQuestionFingerprint(text);
      if (fingerprints.has(fingerprint)) return [];
      fingerprints.add(fingerprint);
      return [{ ...question, text, topics: [...new Set(question.topics)] }];
    });
    const total = (questionCountBySource.get(sourceUrl) ?? 0) + questions.length;
    if (total > brief.maxQuestionsPerSource) {
      throw new TypeError('Research bundle exceeds the per-source question limit.');
    }
    questionCountBySource.set(sourceUrl, total);
    return { ...experience, sourceUrl, questions };
  });
  if (experiences.some((experience) => experience.questions.length === 0)) {
    throw new TypeError('Research experience has no unique questions.');
  }
  assertContainsResearchFindings([...sources.values()], experiences, parsed.warnings);
  return communityResearchBundleSchema.parse({
    ...parsed,
    sources: [...sources.values()],
    experiences,
  });
}
