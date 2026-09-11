import { SourceError, type SourcePageCollection } from '@jobhunter/source-core';
import { z } from 'zod';

/** 国内三渠道、四个物理来源采用官方导航指向的独立站点，不混入海外站。 */
export const didiSites = {
  'didi.social': {
    channel: 'social',
    host: 'talent.didiglobal.com',
    entry: 'https://talent.didiglobal.com/social/list/1',
    detail: 'https://talent.didiglobal.com/social/p/',
    pageSize: 16,
    siteId: null,
  },
  'didi.intern': {
    channel: 'intern',
    host: 'app.mokahr.com',
    entry: 'https://app.mokahr.com/apply/didiglobal/6222#/jobs',
    detail: 'https://app.mokahr.com/apply/didiglobal/6222#/job/',
    pageSize: 30,
    siteId: '6222',
  },
  'didi.campus': {
    channel: 'campus',
    host: 'campus.didiglobal.com',
    entry: 'https://campus.didiglobal.com/campus_apply/didiglobal/96064#/jobs',
    detail: 'https://campus.didiglobal.com/campus_apply/didiglobal/96064#/job/',
    pageSize: 30,
    siteId: '96064',
  },
  'didi.campus.elite': {
    channel: 'campus',
    host: 'app.mokahr.com',
    entry: 'https://app.mokahr.com/campus-recruitment/didiglobal/116021#/jobs',
    detail: 'https://app.mokahr.com/campus-recruitment/didiglobal/116021#/job/',
    pageSize: 30,
    siteId: '116021',
  },
} as const;
/** 物理来源键。 */
export type DidiKey = keyof typeof didiSites;
/** 明确采样上限，不将部分列表冒充完整同步。容量只能是对应官网已验证值。 */
export function didiConfigSchema(key: DidiKey): z.ZodType<DidiConfig> {
  return z
    .object({
      pageSize: z.literal(didiSites[key].pageSize).default(didiSites[key].pageSize),
      maximumPages: z.number().int().min(1).max(1000).default(1000),
      pageSampling: z.enum(['sequential', 'first-last']).default('sequential'),
    })
    .strict();
}
/** 生产配置。 */
export interface DidiConfig {
  readonly pageSize: number;
  readonly maximumPages: number;
  readonly pageSampling: 'sequential' | 'first-last';
}
/** 已白名单归一后的中间职位；正文缺失只能延迟取详情，不能持久化占位正文。 */
const jobSchema = z.object({
  id: z.string().min(1),
  channel: z.enum(['social', 'intern', 'campus']),
  status: z.enum(['open', 'pause']),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  locations: z.array(z.string().trim().min(1)),
  department: z.string().nullable(),
  education: z.string().nullable(),
  taxonomy: z.string().nullable(),
  publishedAt: z.number().int().nonnegative().nullable(),
  jdNo: z.string().nullable(),
});
/** 白名单公开职位，不包含招聘内部配置或会话字段。 */
export type DidiJob = z.infer<typeof jobSchema>;
const idSchema = z
  .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d*$/)])
  .transform(String);
const socialListSchema = z.object({
  jdId: idSchema,
  jdNo: z.string().min(1),
  jobName: z.string().trim().min(1),
  workArea: z.string().trim().min(1),
  deptName: z.string().nullable().optional(),
});
const socialDetailSchema = z.object({
  jdNo: z.string().min(1),
  jobName: z.string().trim().min(1),
  recruitType: z.literal('1'),
  jdStatus: z.literal(2),
  jobDesc: z.string().trim().min(1),
  qualification: z.string().trim().min(1),
  workArea: z.string().trim().min(1),
  deptName: z.string().nullable().optional(),
  jobType: z.string().nullable().optional(),
});
const mokaJobSchema = z.object({
  id: z.uuid(),
  orgId: z.literal('didiglobal'),
  status: z.enum(['open', 'pause']),
  hireMode: z.number().int(),
  commitment: z.string(),
  title: z.string().trim().min(1),
  jobDescription: z.string().nullable().optional(),
  locations: z.array(
    z.object({
      cityName: z.string().optional(),
      provinceName: z.string().optional(),
      country: z.string().optional(),
    }),
  ),
  department: z.object({ name: z.string() }).nullable().optional(),
  education: z.string().nullable().optional(),
  zhineng: z.object({ name: z.string() }).nullable().optional(),
  publishedAt: z.string().optional(),
});

/** 安全提取正文展示文本，实体只用于纯文本，不重新解释为 HTML。 */
export function didiText(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_m, key: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[key] ?? '',
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (_m, n: string) => {
      const v = n[0]?.toLowerCase() === 'x' ? Number.parseInt(n.slice(1), 16) : Number(n);
      return v > 0 && v <= 0x10ffff && !(v >= 0xd800 && v <= 0xdfff) ? String.fromCodePoint(v) : '';
    })
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** Moka 不带时区的官网时间按中国标准时间解释，拒绝日期溢出。 */
function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    throw new SourceError('parse_changed', 'Didi publication time changed.');
  const full = value.length === 16 ? `${value}:00` : value;
  const ms = Date.parse(`${full}+08:00`);
  if (!Number.isFinite(ms) || new Date(ms + 8 * 3600000).toISOString().slice(0, 19) !== full)
    throw new SourceError('parse_changed', 'Didi publication time is invalid.');
  return ms;
}
/** 公司协议错误不输出原始业务消息。 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SourceError('parse_changed', 'Didi public job schema changed.');
  return parsed.data;
}
/** 社招成功 envelope；访问失败和登录失败不能被解释为零岗位。 */
function socialData(value: unknown): unknown {
  const envelope = parse(
    z.object({ meta: z.object({ code: z.number() }), data: z.unknown().optional() }),
    value,
  );
  if ([10039, 10100].includes(envelope.meta.code))
    throw new SourceError('access_blocked', 'Didi anonymous request is unavailable.');
  if (envelope.meta.code !== 0)
    throw new SourceError('parse_changed', 'Didi business response changed.');
  return envelope.data;
}
/** 校验已清洗记录身份，阻止跨渠道或跨协议 ID 污染。 */
export function parseDidiJob(value: unknown, key: DidiKey): DidiJob {
  const job = parse(jobSchema, value);
  if (
    job.channel !== didiSites[key].channel ||
    !(key === 'didi.social'
      ? /^[1-9]\d*$/.test(job.id) && job.jdNo
      : z.uuid().safeParse(job.id).success)
  )
    throw new SourceError('parse_changed', 'Didi job identity changed.');
  return job;
}
/** Moka 原始客户端已完成业务解封；此处仍校验公开结构与站点所属公司/招聘性质。 */
export function parseDidiMokaJob(value: unknown, key: DidiKey, detail = false): DidiJob {
  const job = parse(mokaJobSchema, value);
  if (
    key === 'didi.social' ||
    job.hireMode !== (key === 'didi.intern' ? 1 : 2) ||
    job.commitment !== (key === 'didi.intern' ? '实习' : '全职')
  )
    throw new SourceError('parse_changed', 'Didi Moka recruitment type changed.');
  const description = job.jobDescription ? didiText(job.jobDescription) : null;
  if ((detail || didiSites[key].channel === 'campus') && !description)
    throw new SourceError('parse_changed', 'Didi job description is missing.');
  return parseDidiJob(
    {
      id: job.id,
      channel: didiSites[key].channel,
      status: job.status,
      title: job.title,
      description,
      locations: job.locations
        .map((l) => [l.cityName, l.provinceName, l.country].find((v) => v?.trim()) ?? '')
        .filter(Boolean),
      department: job.department?.name ?? null,
      education: job.education ?? null,
      taxonomy: job.zhineng?.name ?? null,
      publishedAt: timestamp(job.publishedAt),
      jdNo: null,
    },
    key,
  );
}
/** 列表解析只保存必要公开字段，社招的刷新时间不冒充发布日期。 */
export function parseDidiPage(
  value: unknown,
  key: DidiKey,
  expectedPage = 1,
): { total: number; records: DidiJob[] } {
  if (key === 'didi.social') {
    const data = parse(
      z.object({
        total: z.number().int().nonnegative(),
        items: z.array(socialListSchema),
        page: z.number().int().positive(),
        size: z.literal(16),
      }),
      socialData(value),
    );
    // 1、校验上游实际回显；页码不能由请求自填后冒充已验证响应。
    if (data.page !== expectedPage)
      throw new SourceError('parse_changed', 'Didi response page differs from the requested page.');
    // 2、业务与分页身份一致后，才清洗并输出该页公开岗位。
    return {
      total: data.total,
      records: data.items.map((j) =>
        parseDidiJob(
          {
            id: j.jdId,
            channel: 'social',
            status: 'open',
            jdNo: j.jdNo,
            title: j.jobName,
            description: null,
            locations: j.workArea
              .split(/[,，、]/)
              .map((s) => s.trim())
              .filter(Boolean),
            department: j.deptName ?? null,
            education: null,
            taxonomy: null,
            publishedAt: null,
          },
          key,
        ),
      ),
    };
  }
  const data = parse(
    z.object({
      jobStats: z.object({ orgId: z.literal('didiglobal'), total: z.number().int().nonnegative() }),
      jobs: z.array(z.unknown()),
    }),
    value,
  );
  return { total: data.jobStats.total, records: data.jobs.map((j) => parseDidiMokaJob(j, key)) };
}
/** 详情必须与已发现 ID/招聘编号绑定，不能将相似职位响应作为目标正文。 */
export function parseDidiDetail(value: unknown, key: DidiKey, listed: DidiJob): DidiJob {
  if (key === 'didi.social') {
    const job = parse(socialDetailSchema, socialData(value));
    if (job.jdNo !== listed.jdNo)
      throw new SourceError('parse_changed', 'Didi detail job number differs.');
    return parseDidiJob(
      {
        ...listed,
        title: job.jobName,
        description: `工作职责\n${didiText(job.jobDesc)}\n\n任职要求\n${didiText(job.qualification)}`,
        locations: job.workArea
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean),
        department: job.deptName ?? null,
        taxonomy: job.jobType ?? null,
      },
      key,
    );
  }
  const job = parseDidiMokaJob(value, key, true);
  if (job.id !== listed.id) throw new SourceError('parse_changed', 'Didi detail identity differs.');
  return job;
}
/** 校验完整分页闭合，异常优先于采样原因；partial 不会升级为 complete。 */
export function validateDidiCollection(
  value: SourcePageCollection,
  key: DidiKey,
  size: number,
): SourcePageCollection {
  const total = value.pages[0]?.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)
    throw new SourceError('parse_changed', 'Didi collection lacks a verified total.');
  const expectedPages = Math.max(1, Math.ceil(total / size));
  const ids = new Set<string>();
  const numbers = new Set<number>();
  let duplicateIds = 0;
  let totalChanged = false;
  let invalid = false;
  const pages = [];
  // 1、逐页校验边界、总数、身份与唯一 ID。
  for (const page of value.pages) {
    totalChanged ||= page.total !== total;
    invalid ||=
      !Number.isSafeInteger(page.page) ||
      page.page < 1 ||
      page.page > expectedPages ||
      numbers.has(page.page) ||
      page.records.length !== Math.min(size, Math.max(0, total - (page.page - 1) * size));
    numbers.add(page.page);
    const records = page.records.map((v) => {
      const job = parseDidiJob(v, key);
      if (ids.has(job.id)) duplicateIds += 1;
      ids.add(job.id);
      return job;
    });
    pages.push({ ...page, records });
  }
  // 2、仅全页数、全 ID 与边界同时闭合才可能完成。
  const missing = numbers.size !== expectedPages || ids.size !== total;
  const reason = totalChanged
    ? 'pagination_total_changed'
    : duplicateIds
      ? 'duplicate_job_ids'
      : invalid
        ? 'invalid_page_boundary'
        : (value.diagnostics?.reason ?? (missing ? 'discovered_count_mismatch' : null));
  return {
    ...value,
    pages,
    coverage: totalChanged || duplicateIds || invalid || missing ? 'partial' : value.coverage,
    diagnostics: {
      reason,
      retryable: totalChanged,
      expectedCount: total,
      discoveredCount: ids.size,
      expectedPages,
      fetchedPages: pages.length,
      duplicateIds,
      totalChanged,
    },
  };
}
/** 生产默认顺序采集，显式 smoke 最多三页且包含首尾。 */
export function didiPageNumbers(
  total: number,
  size: number,
  maximum: number,
  sampling: 'sequential' | 'first-last',
): number[] {
  const count = Math.max(1, Math.ceil(total / size));
  return sampling === 'first-last' && count > maximum && maximum >= 2
    ? [...new Set([1, ...(maximum >= 3 ? [Math.ceil(count / 2)] : []), count])]
    : Array.from({ length: Math.min(count, maximum) }, (_, i) => i + 1);
}
