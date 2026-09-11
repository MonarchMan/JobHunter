import { SourceError } from '@jobhunter/source-core';
import { z } from 'zod';

/** B 站社招配置：容量决定分页边界，禁止把关键词过滤误当成全站同步。 */
export const bilibiliSocialConfigSchema = z
  .object({
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict();
/** B 站社招配置类型。 */
export type BilibiliSocialConfig = z.infer<typeof bilibiliSocialConfigSchema>;

/** 公开职位白名单；Worker 将数字 ID 转成字符串后仍能解析。 */
export const bilibiliSocialJobSchema = z.object({
  id: z
    .union([
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^[1-9]\d*$/),
    ])
    .transform(String),
  positionName: z.string().trim().min(1),
  positionDescription: z.string().trim().min(1),
  positionTypeName: z.literal('全职'),
  recruitType: z.literal(0),
  workLocation: z.string().trim().min(1),
  postCodeName: z.string().nullable().optional(),
  pushTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    .nullable()
    .optional(),
});
/** 已校验并去除额外字段的公开职位。 */
export type BilibiliSocialJob = z.infer<typeof bilibiliSocialJobSchema>;

/** 总数来自响应，容量来自请求；故意不采信响应的 pages/size。 */
const listSchema = z.object({
  code: z.literal(0),
  data: z.object({ total: z.number().int().nonnegative(), list: z.array(bilibiliSocialJobSchema) }),
});
/** 校验官网当前请求仍是无额外过滤的社招频道。 */
const requestSchema = z.object({
  pageNum: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  recruitType: z.literal(0),
  workTypeList: z.tuple([z.literal('3')]),
  positionTypeList: z.tuple([z.literal('3')]),
  positionName: z.literal(''),
  postCode: z.array(z.never()),
  postCodeList: z.array(z.never()),
  workLocationList: z.array(z.never()),
  deptCodeList: z.array(z.never()),
  practiceTypes: z.array(z.never()),
  onlyHotRecruit: z.literal(0),
});

/** 将官网记录解析错误统一为来源协议漂移，不泄露原始响应字段。 */
export function parseBilibiliSocialJob(value: unknown): BilibiliSocialJob {
  const parsed = bilibiliSocialJobSchema.safeParse(value);
  if (!parsed.success)
    throw new SourceError('parse_changed', 'Bilibili social job schema changed.');
  return parsed.data;
}

/** 解析匿名列表业务结果，访问失败不能被解释为空职位。 */
export function parseBilibiliSocialPage(value: unknown): {
  records: BilibiliSocialJob[];
  total: number;
} {
  // 1、先识别已知匿名会话失败，未知业务失败按协议漂移停止，不输出上游 message。
  const envelope = z.object({ code: z.number() }).safeParse(value);
  if (envelope.success && [-101, -111, -403].includes(envelope.data.code)) {
    throw new SourceError('access_blocked', 'Bilibili anonymous session is unavailable.');
  }
  // 2、校验业务成功、总数和每条社招记录，剔除无关字段。
  const parsed = listSchema.safeParse(value);
  if (!parsed.success)
    throw new SourceError('parse_changed', 'Bilibili social list schema changed.');
  if (parsed.data.data.list.length > parsed.data.data.total) {
    throw new SourceError('parse_changed', 'Bilibili list length exceeds its total.');
  }
  return { records: parsed.data.data.list, total: parsed.data.data.total };
}

/** 为浏览器分页器提取已验证的请求容量和页码。 */
export function parseBilibiliSocialRequest(value: unknown): { pageNum: number; pageSize: number } {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success)
    throw new SourceError('parse_changed', 'Bilibili social request filters changed.');
  return { pageNum: parsed.data.pageNum, pageSize: parsed.data.pageSize };
}
