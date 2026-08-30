import {
  communityQuestionFingerprint,
  communityResearchBundleSchema,
  experienceResearchBriefSchema,
  normalizeCommunityQuestion,
  normalizePublicResearchUrl,
  type CommunityResearchBundle,
  type ExperienceResearchBrief,
} from '@jobhunter/domain';

function normalizedDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/gu, '');
}

function matchesDomain(hostname: string, configured: string): boolean {
  const domain = normalizedDomain(configured);
  return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
}

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

export function normalizeCommunityResearchBundle(input: {
  readonly value: unknown;
  readonly brief: ExperienceResearchBrief;
  readonly expectedFingerprint: string;
}): CommunityResearchBundle {
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
  return communityResearchBundleSchema.parse({
    ...parsed,
    sources: [...sources.values()],
    experiences,
  });
}
