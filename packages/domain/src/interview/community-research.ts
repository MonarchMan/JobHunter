import { z } from 'zod';
import { contentHash, type ContentHash } from '../shared/canonical.js';
import { DomainError } from '../shared/domain-error.js';

export const communityResearchPromptVersion = 'community-research-prompt@v3' as const;
export const communityResearchSchemaVersion = 'community-research-bundle@v1' as const;

const nullableText = (maximum: number): z.ZodNullable<z.ZodString> =>
  z.string().trim().min(1).max(maximum).nullable();

function matchesHostnameSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function isSpecialUseResearchHostname(hostname: string): boolean {
  return (
    ['localhost', 'local', 'invalid', 'example', 'test'].some((suffix) =>
      matchesHostnameSuffix(hostname, suffix),
    ) ||
    ['example.com', 'example.net', 'example.org'].some((domain) =>
      matchesHostnameSuffix(hostname, domain),
    )
  );
}

const researchDomainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value) => value.toLowerCase().replace(/^\.+|\.+$/gu, ''))
  .pipe(
    z
      .string()
      .min(1)
      .max(253)
      .regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u,
        'Research domain is invalid.',
      ),
  );

export const experienceResearchBriefSchema = z
  .object({
    targetRoles: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
    companies: z.array(z.string().trim().min(1).max(120)).max(20),
    locations: z.array(z.string().trim().min(1).max(120)).max(20),
    levels: z.array(z.string().trim().min(1).max(80)).max(10),
    stages: z.array(z.string().trim().min(1).max(80)).max(10),
    dateFrom: z.iso.date().nullable(),
    dateTo: z.iso.date().nullable(),
    language: z.enum(['zh-CN', 'en']),
    maxSources: z.number().int().min(1).max(20),
    maxQuestionsPerSource: z.number().int().min(1).max(30),
    allowedDomains: z.array(researchDomainSchema).max(30),
    blockedDomains: z.array(researchDomainSchema).max(30),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'Research end date must not be earlier than the start date.',
      });
    }
    const allowed = new Set(value.allowedDomains.map((domain) => domain.toLowerCase()));
    const overlap = value.blockedDomains.find((domain) => allowed.has(domain.toLowerCase()));
    if (overlap) {
      context.addIssue({
        code: 'custom',
        path: ['blockedDomains'],
        message: `Domain cannot be both allowed and blocked: ${overlap}`,
      });
    }
  });
export type ExperienceResearchBrief = z.infer<typeof experienceResearchBriefSchema>;

const researchSourceSchema = z
  .object({
    url: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(300),
    publishedAt: z.iso.datetime().nullable(),
    retrievedAt: z.iso.datetime(),
  })
  .strict();

const communityQuestionSchema = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    answerExcerpt: nullableText(500),
    topics: z.array(z.string().trim().min(1).max(80)).max(20),
    evidenceExcerpt: z.string().trim().min(1).max(500),
  })
  .strict();

export const communityResearchBundleSchema = z
  .object({
    schemaVersion: z.literal(communityResearchSchemaVersion),
    requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    generatedAt: z.iso.datetime(),
    sources: z.array(researchSourceSchema).min(1).max(20),
    experiences: z
      .array(
        z
          .object({
            company: nullableText(200),
            role: nullableText(200),
            stage: nullableText(100),
            occurredAt: z.union([z.iso.date(), z.iso.datetime()]).nullable(),
            sourceUrl: z.string().trim().min(1).max(2_000),
            questions: z.array(communityQuestionSchema).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    warnings: z.array(z.string().trim().min(1).max(500)).max(50),
  })
  .strict();
export type CommunityResearchBundle = z.infer<typeof communityResearchBundleSchema>;

export const experienceResearchStatusSchema = z.enum([
  'ready',
  'queued',
  'running',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
]);
export type ExperienceResearchStatus = z.infer<typeof experienceResearchStatusSchema>;

export const communityExperienceReviewStatusSchema = z.enum([
  'draft',
  'needs_review',
  'accepted',
  'rejected',
]);
export type CommunityExperienceReviewStatus = z.infer<typeof communityExperienceReviewStatusSchema>;

function fingerprintSet(values: readonly string[], domain = false): readonly string[] {
  return [
    ...new Set(
      values.map((value) => {
        const normalized = value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
        return domain ? normalized.replace(/^\.+|\.+$/gu, '') : normalized;
      }),
    ),
  ];
}

export function researchRequestFingerprint(brief: ExperienceResearchBrief): ContentHash {
  const normalized = experienceResearchBriefSchema.parse(brief);
  return contentHash(
    {
      brief: {
        ...normalized,
        targetRoles: fingerprintSet(normalized.targetRoles),
        companies: fingerprintSet(normalized.companies),
        locations: fingerprintSet(normalized.locations),
        levels: fingerprintSet(normalized.levels),
        stages: fingerprintSet(normalized.stages),
        allowedDomains: fingerprintSet(normalized.allowedDomains, true),
        blockedDomains: fingerprintSet(normalized.blockedDomains, true),
      },
      promptVersion: communityResearchPromptVersion,
      schemaVersion: communityResearchSchemaVersion,
    },
    [
      '/brief/targetRoles',
      '/brief/companies',
      '/brief/locations',
      '/brief/levels',
      '/brief/stages',
      '/brief/allowedDomains',
      '/brief/blockedDomains',
    ],
  );
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

export function normalizePublicResearchUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError('INVALID_RESEARCH_SOURCE', 'Research source URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new DomainError('INVALID_RESEARCH_SOURCE', 'Research source must be a public HTTP URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  url.hostname = hostname;
  const address =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (
    isSpecialUseResearchHostname(hostname) ||
    address === '::' ||
    address === '::1' ||
    /^fe[89ab]/u.test(address) ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('::ffff:') ||
    privateIpv4(address)
  ) {
    throw new DomainError(
      'INVALID_RESEARCH_SOURCE',
      'Research source must be publicly addressable.',
    );
  }
  url.hash = '';
  return url.toString();
}

export function normalizeCommunityQuestion(value: string): string {
  return value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
}

export function communityQuestionFingerprint(value: string): ContentHash {
  const normalized = normalizeCommunityQuestion(value).toLocaleLowerCase('en-US');
  if (!normalized) {
    throw new DomainError('INVALID_RESEARCH_QUESTION', 'Community interview question is empty.');
  }
  return contentHash(normalized);
}
