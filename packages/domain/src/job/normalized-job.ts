import { z } from 'zod';
import {
  contentHash,
  idSchema,
  utcInstantSchema,
  type CompanyId,
  type ContentHash,
  type JobSourceId,
} from '../shared/index.js';

declare const canonicalUrlBrand: unique symbol;
export type CanonicalUrl = string & { readonly [canonicalUrlBrand]: true };

function inlineText(value: unknown): unknown {
  return typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : value;
}

function blockText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => line.replaceAll(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

const requiredInlineText = z.preprocess(inlineText, z.string().min(1));
const optionalInlineText = z.preprocess(inlineText, z.string().min(1).nullable());
const descriptionText = z.preprocess(blockText, z.string().min(1));
const canonicalUrlSchema: z.ZodType<CanonicalUrl> = z
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'Official URLs must use HTTPS.')
  .refine(
    (value) => !new URL(value).username && !new URL(value).password,
    'URLs cannot contain credentials.',
  )
  .transform((value) => {
    const url = new URL(value);
    if (!url.hash.startsWith('#/')) url.hash = '';
    return url.toString() as CanonicalUrl;
  });

export const normalizedJobSchema = z
  .object({
    companyId: idSchema('Company'),
    sourceId: idSchema('JobSource'),
    externalJobId: requiredInlineText,
    title: requiredInlineText,
    department: optionalInlineText,
    jobFamily: optionalInlineText,
    jobSubfamily: z.preprocess(inlineText, z.string().min(1).nullable().default(null)),
    locations: z
      .array(requiredInlineText)
      .transform((locations) =>
        [...new Set(locations)].toSorted((left, right) => left.localeCompare(right)),
      ),
    employmentType: optionalInlineText,
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).nullable().default(null),
    experienceText: optionalInlineText,
    educationText: optionalInlineText,
    description: descriptionText,
    detailUrl: canonicalUrlSchema,
    applyUrl: canonicalUrlSchema,
    publishedAt: utcInstantSchema.nullable(),
  })
  .readonly();

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export interface SourceJobIdentity {
  readonly sourceId: JobSourceId;
  readonly externalJobId: string;
}

export function sourceJobIdentity(
  job: Pick<NormalizedJob, 'externalJobId' | 'sourceId'>,
): SourceJobIdentity {
  return { sourceId: job.sourceId, externalJobId: job.externalJobId };
}

export function normalizedJobContentHash(job: NormalizedJob): ContentHash {
  return contentHash(job, ['/locations']);
}

export function parseNormalizedJob(input: unknown): NormalizedJob {
  return normalizedJobSchema.parse(input);
}

export type { CompanyId, JobSourceId };
