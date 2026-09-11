import {
  SourceError,
  type SourceHttpRequest,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import { z } from 'zod';

/** 官网招聘分区和职位性质共同决定渠道，不按职位名或固定届次猜测。 */
export const mihoyoSites = {
  'mihoyo.social': { channel: 'social', hireType: 0, nature: null },
  'mihoyo.intern': { channel: 'intern', hireType: 1, nature: 3 },
  'mihoyo.campus': { channel: 'campus', hireType: 1, nature: 1 },
} as const;
/** 当前已验证的独立物理来源。 */
export type MihoyoKey = keyof typeof mihoyoSites;
/** 显式有界采样；正常生产默认顺序采集。 */
export const mihoyoConfigSchema = z
  .object({
    pageSize: z.literal(10).default(10),
    maximumPages: z.number().int().min(1).max(1000).default(1000),
    pageSampling: z.enum(['sequential', 'first-last']).default('sequential'),
  })
  .strict();
/** 米哈游来源运行参数。 */
export type MihoyoConfig = z.infer<typeof mihoyoConfigSchema>;
const idSchema = z.string().regex(/^[1-9]\d*$/);
/** 白名单剔除用户投递状态、内部代码和其他无关配置。 */
const jobSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1),
  addressDetailList: z.array(z.object({ addressDetail: z.string().trim().min(1) })),
  competencyType: z.string(),
  jobNature: z.enum(['全职', '实习', '第三方编制']),
  jobNatureId: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  projectName: z.string().trim().min(1),
  channelDetailIds: z.array(z.number().int()),
});
/** 公开列表记录没有正文，只能先调用 required 详情再入库。 */
export type MihoyoJob = z.infer<typeof jobSchema>;
const detailSchema = jobSchema.extend({
  hireType: z.union([z.literal(0), z.literal(1)]),
  status: z.number().int(),
  description: z.string().trim().min(1),
  jobRequire: z.string().trim().min(1),
});
/** 完整公开职责与要求。 */
export type MihoyoDetail = z.infer<typeof detailSchema>;
/** 返回安全固定错误，不泄露上游消息和响应原文。 */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SourceError('parse_changed', 'Mihoyo public response changed.');
  return result.data;
}
/** 成功 envelope 才能提供业务数据，认证异常不能冒充零岗位。 */
function data(value: unknown): unknown {
  const envelope = parse(
    z.object({ code: z.number().int(), success: z.boolean(), data: z.unknown().optional() }),
    value,
  );
  if (envelope.code === -3)
    throw new SourceError('access_blocked', 'Mihoyo anonymous access is unavailable.');
  if (envelope.code !== 0 || !envelope.success)
    throw new SourceError('parse_changed', 'Mihoyo business request failed.');
  return envelope.data;
}
/** 每条记录确认官网发布渠道与招聘性质；项目名不参与年份猜测。 */
export function parseMihoyoJob(value: unknown, key: MihoyoKey): MihoyoJob {
  const job = parse(jobSchema, value);
  const site = mihoyoSites[key];
  if (
    !job.channelDetailIds.includes(1) ||
    !(site.hireType === 0 ? [1, 5].includes(job.jobNatureId) : job.jobNatureId === site.nature) ||
    job.jobNature !== ({ 1: '全职', 3: '实习', 5: '第三方编制' } as const)[job.jobNatureId]
  )
    throw new SourceError('parse_changed', 'Mihoyo recruitment channel differs.');
  return job;
}
/** 明确校验上游页号与容量回显，不以请求参数自填。 */
export function parseMihoyoPage(
  value: unknown,
  key: MihoyoKey,
  page: number,
): { total: number; records: MihoyoJob[] } {
  const result = parse(
    z.object({
      list: z.array(z.unknown()),
      total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      pageNo: z.number().int().positive(),
      pageSize: z.literal(10),
    }),
    data(value),
  );
  if (result.pageNo !== page)
    throw new SourceError('parse_changed', 'Mihoyo response page differs.');
  return { total: result.total, records: result.list.map((v) => parseMihoyoJob(v, key)) };
}
/** required 详情必须匹配稳定 ID、招聘分区并仍在开放；缺失正文直接失败。 */
export function parseMihoyoDetail(value: unknown, key: MihoyoKey, id: string): MihoyoDetail {
  // 1、解析真实详情；2、确认归属与身份；3、只接受开放岗位。
  const result = parse(detailSchema, data(value));
  parseMihoyoJob(result, key);
  if (result.id !== id || result.hireType !== mihoyoSites[key].hireType)
    throw new SourceError('parse_changed', 'Mihoyo detail identity or hire type differs.');
  if (result.status !== 1) throw new SourceError('not_found', 'Mihoyo job is not open.');
  return result;
}
/** 官网 hash 路由保留岗位级深链，拒绝路径注入。 */
export function mihoyoUrl(key: MihoyoKey, id?: string): string {
  if (id !== undefined) parse(idSchema, id);
  return `https://jobs.mihoyo.com/#/${mihoyoSites[key].hireType === 1 ? 'campus/' : ''}position${id === undefined ? '' : `/${id}`}`;
}
/** 固定公开 endpoint，不携带 Cookie、认证、签名或追踪信息。 */
export function mihoyoRequest(
  key: MihoyoKey,
  context: SourceRequestContext<MihoyoConfig>,
  page: number,
  id?: string,
): SourceHttpRequest {
  const site = mihoyoSites[key];
  if (id !== undefined) parse(idSchema, id);
  return {
    sourceKey: key,
    requestId: context.requestId,
    allowedHosts: ['ats.openout.mihoyo.com'],
    url: `https://ats.openout.mihoyo.com/ats-portal/v1/job/${id === undefined ? 'list' : 'info'}`,
    method: 'POST',
    responseType: 'json',
    signal: context.signal,
    timeoutMs: context.timeoutMs,
    maximumResponseBytes: 2 * 1024 * 1024,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelDetailIds: [1],
      hireType: site.hireType,
      ...(id === undefined
        ? {
            pageNo: page,
            pageSize: 10,
            ...(site.hireType === 1 ? { jobNatures: [site.nature] } : {}),
          }
        : { id }),
    }),
  };
}
