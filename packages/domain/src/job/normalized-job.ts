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
/** 领域模型的类型约束。 */
export type CanonicalUrl = string & { readonly [canonicalUrlBrand]: true };

/** 规范化单行职位字段。 */
function inlineText(value: unknown): unknown {
  return typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : value;
}

/** 规范化多行职位描述并压缩多余空行。 */
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

/** 职位同步在领域层使用的完整规范结构。 */
export const normalizedJobSchema = z
  .object({
    companyId: idSchema('Company'),
    sourceId: idSchema('JobSource'),
    externalJobId: requiredInlineText,
    title: requiredInlineText,
    department: optionalInlineText,
    jobFamily: optionalInlineText,
    jobSubfamily: z.preprocess(inlineText, z.string().min(1).nullable().default(null)),
    locations: z.array(requiredInlineText).transform((locations) =>
      // 地点属于中文业务字段，显式固定 locale，避免不同机器的默认语言环境产生不同顺序。
      [...new Set(locations)].toSorted((left, right) => left.localeCompare(right, 'zh-CN')),
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

/** 领域模型的类型约束。 */
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

/** 模块数据结构或契约。 */
export interface SourceJobIdentity {
  readonly sourceId: JobSourceId;
  readonly externalJobId: string;
}

/** 从规范职位提取来源身份。 */
export function sourceJobIdentity(
  job: Pick<NormalizedJob, 'externalJobId' | 'sourceId'>,
): SourceJobIdentity {
  return { sourceId: job.sourceId, externalJobId: job.externalJobId };
}

/** 计算职位内容哈希，并将地点数组视为无序集合。 */
export function normalizedJobContentHash(job: NormalizedJob): ContentHash {
  return contentHash(job, ['/locations']);
}

/** 在领域边界校验外部职位数据。 */
export function parseNormalizedJob(input: unknown): NormalizedJob {
  return normalizedJobSchema.parse(input);
}

export type { CompanyId, JobSourceId };
