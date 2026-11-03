import { z } from 'zod';
import type { BilibiliJob } from '../shared/adapter.js';
/** 校园协议的纯解析入口；函数不依赖 this 或运行时状态。 */
interface BilibiliCampusProtocol {
  readonly parseJob: (value: unknown) => BilibiliJob;
  readonly parsePage: (value: unknown) => { records: BilibiliJob[]; total: number };
  readonly parseRequest: (value: unknown) => { pageNum: number; pageSize: number };
}
import { SourceError } from '@jobhunter/recruitment/source-contracts';
import { bilibiliSocialJobSchema, bilibiliSocialConfigSchema } from '../social/schemas.js';
/** 校园两渠道使用相同容量约束，业务分类在记录边界分别校验。 */
export const bilibiliCampusConfigSchema = bilibiliSocialConfigSchema;
/** 校园来源配置，不接受额外筛选。 */
export type BilibiliCampusConfig = z.infer<typeof bilibiliCampusConfigSchema>;
/** 创建校园协议解析器；实习虽然位于校园站，记录 recruitType 仍为 0。 */
export function bilibiliCampusProtocol(channel: 'campus' | 'intern'): BilibiliCampusProtocol {
  const intern = channel === 'intern';
  const jobSchema = bilibiliSocialJobSchema.extend({
    recruitType: z.literal(intern ? 0 : 1),
    positionTypeName: z.literal(intern ? '实习' : '全职'),
  });
  const requestSchema = z
    .object({
      pageNum: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(100),
      recruitType: z.literal(intern ? 0 : 1).nullable(),
      workTypeList: z.tuple([z.literal(intern ? '0' : '3')]),
      positionTypeList: z.tuple([z.literal(intern ? '0' : '3')]),
      positionName: z.literal(''),
      postCode: z.array(z.never()),
      postCodeList: z.array(z.never()),
      workLocationList: z.array(z.never()),
      deptCodeList: z.array(z.never()),
      practiceTypes: z.array(z.never()),
      onlyHotRecruit: z.literal(0),
    })
    .strict();
  return {
    /** 校验并剔除所有非公开业务字段。 */
    parseJob(value: unknown) {
      const parsed = jobSchema.safeParse(value);
      if (!parsed.success)
        throw new SourceError('parse_changed', 'Bilibili campus job schema changed.');
      return parsed.data;
    },
    /** 先区分会话失败，再验证成功 envelope；不采信 pages/size。 */
    parsePage(value: unknown) {
      const envelope = z.object({ code: z.number() }).safeParse(value);
      if (envelope.success && [-101, -111, -403].includes(envelope.data.code))
        throw new SourceError('access_blocked', 'Bilibili anonymous session is unavailable.');
      const parsed = z
        .object({
          code: z.literal(0),
          data: z.object({ total: z.number().int().nonnegative(), list: z.array(jobSchema) }),
        })
        .safeParse(value);
      if (!parsed.success)
        throw new SourceError('parse_changed', 'Bilibili campus list schema changed.');
      if (parsed.data.data.list.length > parsed.data.data.total)
        throw new SourceError('parse_changed', 'Bilibili list length exceeds its total.');
      return { records: parsed.data.data.list, total: parsed.data.data.total };
    },
    /** 空筛选确保同步覆盖全渠道；不接受热门或单一实习项目过滤。 */
    parseRequest(value: unknown) {
      const parsed = requestSchema.safeParse(value);
      if (!parsed.success)
        throw new SourceError('parse_changed', 'Bilibili campus request filters changed.');
      return { pageNum: parsed.data.pageNum, pageSize: parsed.data.pageSize };
    },
  };
}
