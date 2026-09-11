import { SourceError, type SourcePageCollection } from '@jobhunter/source-core';
import { z } from 'zod';

/** 快手三个逻辑渠道对应四个独立分页与身份空间。 */
export const kuaishouDefinitions = {
  'kuaishou.social': { channel: 'social', campus: false, nature: 'C001' },
  'kuaishou.intern': { channel: 'intern', campus: false, nature: 'C002' },
  'kuaishou.intern.campus': { channel: 'intern', campus: true, nature: 'intern' },
  'kuaishou.campus': { channel: 'campus', campus: true, nature: 'fulltime' },
} as const;
/** 仅允许已验证的四个来源，不开放任意官网方法。 */
export type KuaishouKey = keyof typeof kuaishouDefinitions;
/** 配置只允许改变容量，不能添加过滤器缩小完整同步范围。 */
export const kuaishouConfigSchema = z
  .object({ pageSize: z.number().int().min(1).max(100).default(50) })
  .strict();
/** 生产配置。 */
export type KuaishouConfig = z.infer<typeof kuaishouConfigSchema>;

/** 校验来源身份后返回站点入口；校园年份由项目接口动态解析。 */
export function kuaishouSite(key: string): (typeof kuaishouDefinitions)[KuaishouKey] & {
  host: string;
  base: string;
  entry: string;
  detail: string;
  bootstrap: string;
  endpoint: string;
} {
  if (!Object.hasOwn(kuaishouDefinitions, key))
    throw new SourceError('parse_changed', 'Unknown Kuaishou source.');
  const definition = kuaishouDefinitions[key as KuaishouKey];
  const host = definition.campus ? 'campus.kuaishou.cn' : 'zhaopin.kuaishou.cn';
  const base = definition.campus ? `https://${host}/recruit/campus/e/` : `https://${host}/`;
  const route = definition.campus
    ? 'campus'
    : `official/${definition.channel === 'social' ? 'social' : 'trainee'}`;
  return {
    ...definition,
    host,
    base,
    entry: `${base}#/${route}/${definition.campus ? 'jobs' : ''}`,
    detail: `${base}#/${route}/job-info/`,
    bootstrap: definition.campus ? `${base}#/campus/index/` : base,
    endpoint: definition.campus
      ? '/recruit/campus/e/api/v1/open/positions/simple'
      : '/recruit/e/api/v1/open/positions/simple',
  };
}

const codeName = z.object({ code: z.string().min(1), name: z.string().trim().min(1) });
/** 原始公开记录白名单，未知内部字段在边界剔除。 */
const rawJobSchema = z.object({
  id: z
    .union([
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      z.string().regex(/^[1-9]\d*$/),
    ])
    .transform(String),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  positionDemand: z.string().trim().min(1),
  positionNatureCode: z.string(),
  recruitProjectCode: z.string(),
  recruitSubProjectCode: z.string().nullable().optional(),
  workLocationsCode: z.array(z.string()).nullable().optional(),
  workLocationDicts: z.array(codeName).nullable().optional(),
  positionCategoryCode: z.string().nullable().optional(),
  workExperienceCode: z.string().nullable().optional(),
});
/** 供持久化和归一化使用的脱敏、已解码记录。 */
const jobSchema = rawJobSchema.extend({
  locations: z.array(z.string().trim().min(1)).min(1),
  experienceText: z.string().nullable(),
  categoryName: z.string().nullable(),
});
/** 快手公开职位。 */
export type KuaishouJob = z.infer<typeof jobSchema>;
/** 主站字典；校园站的职位自带地点字典。 */
export type KuaishouDictionaries = Record<string, { code: string; name: string }[]>;

/** 只接受成功业务响应，错误消息不透传，避免泄露内部内容。 */
function result(value: unknown): unknown {
  const parsed = z.object({ code: z.literal(0), result: z.unknown() }).safeParse(value);
  if (!parsed.success)
    throw new SourceError(
      'parse_changed',
      'Kuaishou public API did not return a valid success envelope.',
    );
  return parsed.data.result;
}

/** 解析官网字典，未知代码在岗位解析时拒绝，而不是把编码当城市名。 */
export function parseKuaishouDictionaries(value: unknown): KuaishouDictionaries {
  const parsed = z.record(z.string(), z.array(codeName)).safeParse(result(value));
  if (!parsed.success) throw new SourceError('parse_changed', 'Kuaishou dictionaries changed.');
  return parsed.data;
}

/** 最新有效年份必须只有一个对应类型项目；旧项目的 active 不能代表当前项目。 */
export function selectKuaishouProject(value: unknown, nature: string): string {
  // 1、项目清单必须完整，避免把截断结果误当最新届次。
  const parsed = z
    .object({
      total: z.number().int().nonnegative(),
      list: z.array(
        z.object({
          code: z.string().min(1),
          year: z.string().regex(/^\d{4}$/),
          active: z.boolean(),
          projectType: z.string(),
        }),
      ),
    })
    .safeParse(result(value));
  if (!parsed.success || parsed.data.total !== parsed.data.list.length)
    throw new SourceError('parse_changed', 'Kuaishou project list is incomplete.');
  // 2、按官网年份选当前类型项目；不存在或歧义时停止而不是静默选错渠道。
  const candidates = parsed.data.list.filter((p) => p.active && p.projectType === nature);
  const year = Math.max(...candidates.map((p) => Number(p.year)));
  const latest = candidates.filter((p) => Number(p.year) === year);
  if (latest.length !== 1 || !latest[0])
    throw new SourceError('parse_changed', 'Kuaishou current project is missing or ambiguous.');
  return latest[0].code;
}

/** 校验经过浏览器返回的岗位仍属于指定物理来源。 */
export function parseKuaishouJob(value: unknown, key: KuaishouKey): KuaishouJob {
  const parsed = jobSchema.safeParse(value);
  const site = kuaishouSite(key);
  if (
    !parsed.success ||
    parsed.data.positionNatureCode !== site.nature ||
    parsed.data.recruitProjectCode !== (site.campus ? 'schoolr' : 'socialr') ||
    (site.campus && !parsed.data.recruitSubProjectCode)
  )
    throw new SourceError('parse_changed', 'Kuaishou job identity or channel changed.');
  return parsed.data;
}

/** 解析列表并解码地点/经验，校验页码容量及校园项目，不信任 pages 等冗余字段。 */
export function parseKuaishouPage(
  value: unknown,
  key: KuaishouKey,
  pageNum: number,
  pageSize: number,
  dictionaries: KuaishouDictionaries = {},
  project?: string,
): { total: number; records: KuaishouJob[] } {
  // 1、白名单解析公开数据；整页不符合协议时不能报告为合法零结果。
  const parsed = z
    .object({
      total: z.number().int().nonnegative(),
      pageNum: z.literal(pageNum),
      pageSize: z.literal(pageSize),
      list: z.array(rawJobSchema),
    })
    .safeParse(result(value));
  if (!parsed.success) throw new SourceError('parse_changed', 'Kuaishou list schema changed.');
  const site = kuaishouSite(key);
  const lookup = (type: string, code: string): string => {
    const matches = dictionaries[type]?.filter((item) => item.code === code) ?? [];
    if (matches.length !== 1 || !matches[0])
      throw new SourceError('parse_changed', 'Kuaishou dictionary code is missing or ambiguous.');
    return matches[0].name;
  };
  // 2、每条记录独立检查招聘性质和项目，不能用标题猜测或混入其他届次。
  const records = parsed.data.list.map((job) => {
    if (site.campus && (!project || job.recruitSubProjectCode !== project))
      throw new SourceError('parse_changed', 'Kuaishou campus project changed.');
    return parseKuaishouJob(
      {
        ...job,
        locations: site.campus
          ? job.workLocationDicts?.map((item) => item.name)
          : job.workLocationsCode?.map((code) => lookup('workLocation', code)),
        experienceText:
          !site.campus && job.workExperienceCode
            ? lookup('positionExperience', job.workExperienceCode)
            : null,
        categoryName:
          !site.campus && job.positionCategoryCode
            ? lookup('positionCategory', job.positionCategoryCode)
            : null,
      },
      key,
    );
  });
  return { total: parsed.data.total, records };
}

/** 两层共同使用完整性校验，防止截断、重复、总数漂移或缺页关闭已有职位。 */
export function validateKuaishouCollection(
  collection: SourcePageCollection,
  key: KuaishouKey,
  pageSize: number,
): SourcePageCollection {
  // 1、零结果也必须提供成功响应首页及确切总数。
  const total = collection.pages[0]?.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)
    throw new SourceError('parse_changed', 'Kuaishou collection has no verified total.');
  const expectedPages = Math.max(1, Math.ceil(total / pageSize));
  const ids = new Set<string>();
  const numbers = new Set<number>();
  let duplicateIds = 0;
  let totalChanged = false;
  let invalidBoundary = false;
  const projects = new Set<string>();
  const pages = [];
  for (const page of collection.pages) {
    totalChanged ||= page.total !== total;
    invalidBoundary ||=
      !Number.isSafeInteger(page.page) ||
      page.page < 1 ||
      page.page > expectedPages ||
      numbers.has(page.page) ||
      page.records.length !== Math.min(pageSize, Math.max(0, total - (page.page - 1) * pageSize));
    numbers.add(page.page);
    const records = page.records.map((value) => {
      const job = parseKuaishouJob(value, key);
      if (ids.has(job.id)) duplicateIds += 1;
      ids.add(job.id);
      if (job.recruitSubProjectCode) projects.add(job.recruitSubProjectCode);
      return job;
    });
    pages.push({ ...page, records });
  }
  if (kuaishouSite(key).campus && projects.size > 1)
    throw new SourceError('parse_changed', 'Kuaishou collection mixes campus projects.');
  // 2、异常优先于采样原因；已标 partial 的集合永远不会被升级为 complete。
  const missing = numbers.size !== expectedPages || ids.size !== total;
  const reason = totalChanged
    ? 'pagination_total_changed'
    : duplicateIds
      ? 'duplicate_job_ids'
      : invalidBoundary
        ? 'invalid_page_boundary'
        : (collection.diagnostics?.reason ?? (missing ? 'discovered_count_mismatch' : null));
  return {
    ...collection,
    pages,
    coverage:
      totalChanged || duplicateIds || invalidBoundary || missing ? 'partial' : collection.coverage,
    diagnostics: {
      ...collection.diagnostics,
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
