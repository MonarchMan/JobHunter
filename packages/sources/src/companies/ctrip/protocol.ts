import {
  SourceError,
  type SourceHttpRequest,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import { z } from 'zod';

/** 官网当前开放的三个招聘分区；留用实习未开放，不创建占位来源。 */
export const ctripSites = {
  'ctrip.social': { channel: 'social', section: 'experienced', category: '1', kind: '1' },
  'ctrip.intern': { channel: 'intern', section: 'experienced', category: '1', kind: '3' },
  'ctrip.campus': { channel: 'campus', section: 'campus', category: '2', kind: '1' },
} as const;
/** 三个独立物理来源的稳定键。 */
export type CtripKey = keyof typeof ctripSites;
/** 固定已验证容量；采样必须显式配置，生产默认顺序分页。 */
export const ctripConfigSchema = z
  .object({
    pageSize: z.literal(10).default(10),
    maximumPages: z.number().int().min(1).max(1000).default(1000),
    pageSampling: z.enum(['sequential', 'first-last']).default('sequential'),
  })
  .strict();
/** 生产与 smoke 共用的有限分页配置。 */
export type CtripConfig = z.infer<typeof ctripConfigSchema>;
const idSchema = z.string().regex(/^MJ\d+$/);
/** 只保留公开职位字段，默认剔除 user、HR、内部行 ID 等额外数据。 */
const jobSchema = z.object({
  fromId: idSchema,
  jobTitle: z.string().trim().min(1),
  category: z.enum(['1', '2']),
  kind: z.string().min(1),
  requirements: z.string(),
  duty: z.string().nullable().optional(),
  cityName: z.string().nullable(),
  buName: z.string().nullable().optional(),
  jobFamilyGroupName: z.string().nullable().optional(),
  publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
/** 白名单中间记录，保留原始公开正文供确定性归一化。 */
export type CtripJob = z.infer<typeof jobSchema>;
/** 协议错误不泄露原始响应或内部业务消息。 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SourceError('parse_changed', 'Ctrip public response changed.');
  return result.data;
}
/** 官网纯日期按中国标准时间解释，拒绝无效日期滚动。 */
export function ctripPublishedAt(value: string): number {
  const ms = Date.parse(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(ms) || new Date(ms + 8 * 3600000).toISOString().slice(0, 10) !== value)
    throw new SourceError('parse_changed', 'Ctrip publication date is invalid.');
  return ms;
}
/** HTML 只转为展示纯文本，去除脚本和样式，不执行内容。 */
export function ctripText(value: string): string {
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
/** 合并真实职责与要求，不用职位名称填补缺失正文。 */
export function ctripDescription(job: CtripJob): string {
  return [job.duty, job.requirements]
    .filter(Boolean)
    .map((v) => ctripText(v ?? ''))
    .filter(Boolean)
    .join('\n\n');
}
/** 招聘性质依赖官方 category/kind，而不是标题中的“实习”关键字。 */
export function parseCtripJob(value: unknown, key: CtripKey): CtripJob {
  // 1、白名单校验；2、确认所属分区；3、验证可入库正文及日期。
  const job = parse(jobSchema, value);
  const site = ctripSites[key];
  if (job.category !== site.category || job.kind !== site.kind || !ctripDescription(job))
    throw new SourceError('parse_changed', 'Ctrip recruitment category or body changed.');
  ctripPublishedAt(job.publishDate);
  return job;
}
/** 列表不回显页码，只验证真实 total/记录；完整性由采集器检查。 */
export function parseCtripPage(
  value: unknown,
  key: CtripKey,
): { total: number; records: CtripJob[] } {
  const envelope = parse(
    z.object({ retCode: z.string(), retValue: z.unknown().optional() }),
    value,
  );
  if (envelope.retCode !== '201')
    throw new SourceError('parse_changed', 'Ctrip business response is unsuccessful.');
  const data = parse(
    z.object({
      total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      recruitJobAdList: z.array(z.unknown()),
    }),
    envelope.retValue,
  );
  return { total: data.total, records: data.recruitJobAdList.map((v) => parseCtripJob(v, key)) };
}
/** 详情 smoke 绑定已发现的稳定 fromId，不能接受其他职位或空结果。 */
export function parseCtripDetail(value: unknown, key: CtripKey, id: string): CtripJob {
  const page = parseCtripPage(value, key);
  const job = page.records[0];
  if (page.total !== 1 || page.records.length !== 1 || job?.fromId !== id)
    throw new SourceError('parse_changed', 'Ctrip detail identity differs.');
  return job;
}
/** 官网导航与职位级深链，身份只能为 MJ 编号。 */
export function ctripUrl(key: CtripKey, id?: string): string {
  const site = ctripSites[key];
  if (id !== undefined) parse(idSchema, id);
  return `https://careers.ctrip.com/#/${site.section}/${id === undefined ? `jobList?kind=${site.kind}` : `job-detail/${id}`}`;
}
/** 固定语言偏好不是认证凭据；不附带会话、签名或浏览器指纹。 */
export function ctripRequest(
  key: CtripKey,
  context: SourceRequestContext<CtripConfig>,
  page: number,
  id?: string,
): SourceHttpRequest {
  const site = ctripSites[key];
  if (id !== undefined) parse(idSchema, id);
  return {
    sourceKey: key,
    requestId: context.requestId,
    url: 'https://careers.ctrip.com/api/hrrecruit/getJobAd',
    allowedHosts: ['careers.ctrip.com'],
    method: 'POST',
    responseType: 'json',
    signal: context.signal,
    timeoutMs: context.timeoutMs,
    maximumResponseBytes: 2 * 1024 * 1024,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', Cookie: 'language=zh-CN' },
    body: JSON.stringify({
      condition:
        id === undefined
          ? {
              fromId: [],
              keyword: '',
              kind: [site.kind],
              country: [],
              city: [],
              bucode: [],
              jobFamilyCode: [],
              jobFamilyGroupCode: [],
              category: Number(site.category),
            }
          : { fromId: [id] },
      pager: { index: String(page), size: '10' },
      head: { language: 'zh_CN', version: '1' },
    }),
  };
}
