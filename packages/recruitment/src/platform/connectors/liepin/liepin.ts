import {
  clearPlatformResponse,
  discardPlatformResponse,
  platformResponseText,
} from '../../application/response-diagnostics.js';
import { PlatformRequestPacer } from '../browser/request-pacing.js';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  PlatformCompanyIdentityUnavailable,
  PlatformError,
  PlatformJobPaused,
  type PlatformSession,
  type PlatformBatch,
  type PlatformCandidate,
  type PlatformJobDetail,
  type PlatformErrorEvidence,
} from '@jobhunter/recruitment/platform-contracts';
import type { BrowserCookie } from '../browser/cookies.js';
import { liepinVerificationReason } from './liepin-verification.js';

const endpoint = 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new';
const searchEndpoint = 'https://api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job';
const id = z
  .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d*$/)])
  .transform(String);
const text = z.string().max(2000);
const rowSchema = z.object({
  job: z.object({
    jobId: id,
    title: text.min(1),
    link: z.string().max(4096),
    dq: text,
    salary: text,
    requireEduLevel: text,
    requireWorkYears: text.optional(),
  }),
  comp: z.object({
    compId: z.union([id, z.literal(''), z.literal(0), z.null()]).optional(),
    compName: text.min(1),
  }),
});
const listSchema = z.object({
  flag: z.literal(1),
  data: z.object({
    data: z.array(rowSchema).max(100),
    addData: z.array(rowSchema).max(100),
    hasNextPage: z.boolean(),
  }),
});
const postingSchema = z.object({
  '@type': z.literal('JobPosting'),
  title: text.min(1),
  url: z.string(),
  identifier: z.object({ propertyID: z.literal('liepin.com'), value: id }),
  hiringOrganization: z.object({ name: text.min(1), sameAs: z.string().nullish() }),
  description: z
    .string()
    .trim()
    .min(20)
    .max(200_000)
    .refine((value) => !/<[^>]*>/.test(value)),
});
const requestSchema = z
  .object({
    data: z
      .object({
        operateKind: z.literal('LOGIN'),
        sortType: z.enum(['PC_STU_HP_NEW', 'PC_STU_HP_MIX']),
        selectedExpect: z.string().min(1).max(16000),
        existFallbackResult: z.boolean(),
      })
      .strict(),
  })
  .strict();
/** 搜索条件固定，续批仅改变页码及服务器返回的关联字段。 */
const searchRequestSchema = z
  .object({
    data: z
      .object({
        mainSearchPcConditionForm: z
          .object({
            key: z.string().trim().min(1).max(200),
            currentPage: z.number().int().min(0),
            pageSize: z.number().int().min(1).max(100),
          })
          .loose(),
        passThroughForm: z
          .object({
            scene: z.string(),
            skId: z.string(),
            fkId: z.string(),
            ckId: z.string(),
          })
          .loose(),
      })
      .strict(),
  })
  .strict();
const searchListSchema = z.object({
  flag: z.literal(1),
  data: z.object({
    data: z.object({
      jobCardList: z
        .array(
          rowSchema.extend({
            job: rowSchema.shape.job.extend({ requireEduLevel: text.optional().default('') }),
          }),
        )
        .max(100),
    }),
    pagination: z.object({
      currentPage: z.number().int().min(0),
      pageSize: z.number().int().min(1).max(100),
      totalPage: z.number().int().min(0),
      hasNext: z.boolean(),
    }),
    passThroughData: z.object({
      scene: z.string(),
      skId: z.string(),
      fkId: z.string(),
      ckId: z.string(),
    }),
  }),
});
const headerNames = new Set(
  'accept content-type x-xsrf-token x-client-type x-requested-with x-fscp-std-info x-fscp-fe-version x-fscp-version x-fscp-trace-id x-fscp-bi-stat referer origin cookie'.split(
    ' ',
  ),
);

/** 异步期间 AbortSignal 可变化，每次读取当前状态。 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** 只从有限 cause 链读取已知传输码；异常原文可能含 URL、Cookie，不能进入日志。 */
function networkDiagnostic(error: unknown): { reason: string | null; code: string; name: string } {
  const reasons: Readonly<Record<string, string>> = {
    ECONNRESET: 'connection_reset',
    ETIMEDOUT: 'request_timeout',
    EAI_AGAIN: 'dns_error',
    ECONNREFUSED: 'connection_refused',
    UND_ERR_SOCKET: 'socket_closed',
    UND_ERR_CONNECT_TIMEOUT: 'connect_timeout',
    UND_ERR_HEADERS_TIMEOUT: 'headers_timeout',
    UND_ERR_BODY_TIMEOUT: 'body_timeout',
  };
  let current = error;
  const name =
    error instanceof Error && ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
      ? error.name
      : 'Error';
  // 1、只检查有界异常链，未知 TypeError 不冒充可重试网络故障。
  for (let depth = 0; depth < 3; depth += 1) {
    if (!(current instanceof Error)) break;
    if (current.name === 'TimeoutError') return { reason: 'request_timeout', code: 'none', name };
    const code = 'code' in current ? current.code : undefined;
    if (typeof code === 'string' && Object.hasOwn(reasons, code))
      return { reason: reasons[code] ?? null, code, name };
    current = current.cause;
  }
  return { reason: null, code: 'unknown', name };
}

/** 保留请求阶段、固定错误码和重试次数，不保留底层异常文本或原始响应。 */
class LiepinNetworkError extends PlatformError {
  public constructor(
    phase: 'list' | 'detail' | 'operation',
    diagnostic: ReturnType<typeof networkDiagnostic>,
    attempts: number,
  ) {
    super('network_error', null, diagnostic.reason ?? 'unknown');
    this.message += ` [liepin:${phase};reason=${diagnostic.reason ?? 'unknown'};code=${diagnostic.code};name=${diagnostic.name};attempts=${String(attempts)}]`;
  }
}

/** 仅保留已验证的普通请求字段，浏览器特征头和 Cookie 不随模板跨请求复用。 */
export function liepinRequestHeaders(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.toLowerCase(), value] as const)
      .filter(([key]) => key !== 'cookie' && headerNames.has(key)),
  );
}

/** 针对两个固定 HTTPS 目标匹配 Cookie，保留域、路径、有效期和同名路径优先级。 */
export function liepinCookieHeader(
  cookies: readonly BrowserCookie[],
  target: string,
  now: number,
): string {
  const url = new URL(target);
  if (![new URL(endpoint).origin, 'https://www.liepin.com'].includes(url.origin)) return '';
  return cookies
    .filter((cookie) => {
      const host = cookie.domain.replace(/^\./, '');
      return (
        /^[!#$%&'*+.^_`|~\w-]+$/.test(cookie.name) &&
        !/[\r\n;]/.test(cookie.value) &&
        (cookie.expires < 0 || cookie.expires * 1000 > now) &&
        (!cookie.secure || url.protocol === 'https:') &&
        (cookie.domain.startsWith('.')
          ? url.hostname === host || url.hostname.endsWith(`.${host}`)
          : url.hostname === host) &&
        cookie.path.startsWith('/') &&
        (url.pathname === cookie.path ||
          (url.pathname.startsWith(cookie.path) &&
            (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/')))
      );
    })
    .toSorted((a, b) => b.path.length - a.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

/** 已观察成功的首页推荐模板；原始查询与认证字段仅留内存。 */
export interface LiepinRecommendationTemplate {
  readonly url: string;
  readonly body: string;
}

/** 固定阶段码不含上游原文或私有查询参数。 */
class LiepinParseError extends PlatformError {
  public constructor(
    stage:
      | 'template'
      | 'list_envelope'
      | 'list_main'
      | 'list_extra'
      | 'list_pagination'
      | 'list_job'
      | 'list_company'
      | 'list_schema'
      | 'list_empty'
      | 'list_job_url'
      | 'list_duplicate_in_page'
      | 'list_identity_conflict'
      | 'duplicate_list'
      | 'detail_job_id'
      | 'detail_url'
      | 'detail_title'
      | 'detail_company_url'
      | 'detail_company_id'
      | 'detail_company_name_and_url'
      | 'detail_company_name_and_id'
      | 'detail_jsonld_invalid'
      | 'detail_posting_missing'
      | 'detail_posting_multiple'
      | 'detail_posting_schema'
      | 'body',
    evidence?: PlatformErrorEvidence,
  ) {
    super('parse_changed', stage.startsWith('detail_') ? 200 : null, stage, evidence);
    this.message += ` [liepin:${stage}]`;
  }
}

/** 只把 Zod 的已知字段路径映射为固定阶段，不写入动态校验值或响应正文。 */
function listSchemaStage(
  issues: readonly z.core.$ZodIssue[],
): ConstructorParameters<typeof LiepinParseError>[0] {
  const path = issues[0]?.path;
  if (path?.[0] !== 'data') return 'list_envelope';
  if (path[1] === 'hasNextPage') return 'list_pagination';
  if (path[1] !== 'data' && path[1] !== 'addData') return 'list_schema';
  if (typeof path[2] !== 'number') return path[1] === 'data' ? 'list_main' : 'list_extra';
  if (path[3] === 'job') return 'list_job';
  if (path[3] === 'comp') return 'list_company';
  return path[1] === 'data' ? 'list_main' : 'list_extra';
}

/** 只接受官网已返回的稳定职位 URL；不同公开路径空间不合并身份。 */
function jobIdentity(value: string, evidence: PlatformErrorEvidence): string {
  // 1、搜索还包含 lptjob 命名空间；实测其 JSON-LD 同样提供完整的双重身份。
  const campus = /^https:\/\/www\.liepin\.com\/lptjob\/([1-9]\d*)$/.exec(value);
  if (campus?.[1]) return `lptjob:${campus[1]}`;
  const match = /^https:\/\/www\.liepin\.com\/(job|a)\/([1-9]\d*)\.shtml$/.exec(value);
  if (!match?.[1] || !match[2]) {
    const url = URL.parse(value);
    const linkIssue = !url
      ? 'invalid_url'
      : url.origin !== 'https://www.liepin.com'
        ? 'other_origin'
        : url.search || url.hash
          ? 'query_or_fragment'
          : 'unsupported_path';
    throw new LiepinParseError('list_job_url', { ...evidence, linkIssue });
  }
  return `${match[1]}:${match[2]}`;
}

/** 将成功信封中的主推荐和补充推荐合并，未知结构不能当作末页。 */
function parseList(
  raw: unknown,
  pageIndex?: number,
): { batch: PlatformBatch; ids: Map<string, string> } {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) throw new LiepinParseError(listSchemaStage(parsed.error.issues));
  const candidates: PlatformCandidate[] = [];
  const ids = new Map<string, string>();
  // 1、先核验所有原始身份，包含无公司身份的条目；重复不能静默去重掩盖协议变化。
  const rows = [...parsed.data.data.data, ...parsed.data.data.addData];
  for (const [rowIndex, row] of rows.entries()) {
    const evidence = {
      httpStatus: 200,
      ...(pageIndex === undefined ? {} : { pageIndex }),
      rowCount: rows.length,
      rowIndex,
    };
    const externalJobId = jobIdentity(row.job.link, evidence);
    const previousInternalId = ids.get(externalJobId);
    if (previousInternalId !== undefined)
      throw new LiepinParseError('list_duplicate_in_page', {
        ...evidence,
        externalJobId,
        previousInternalId,
        receivedInternalId: row.job.jobId,
      });
    ids.set(externalJobId, row.job.jobId);
    // 搜索候选可到详情核验公司身份，推荐流仍在列表阶段排除无 ID 的条目。
    if (!row.comp.compId && pageIndex === undefined) continue;
    candidates.push({
      externalJobId,
      externalCompanyId: row.comp.compId === 0 ? '' : (row.comp.compId ?? ''),
      title: row.job.title,
      company: row.comp.compName,
      city: row.job.dq,
      salary: row.job.salary,
      experience: row.job.requireWorkYears ?? '',
      education: row.job.requireEduLevel,
      sourceUrl: row.job.link,
    });
  }
  if (!ids.size && parsed.data.data.hasNextPage) throw new LiepinParseError('list_empty');
  return {
    batch: { candidates, hasMore: parsed.data.data.hasNextPage },
    ids,
  };
}

/** 解析 HTTP HTML 内的结构化职位 JSON，不执行脚本或使用渲染 DOM。 */
function parseDetail(
  html: string,
  candidate: PlatformCandidate,
  internalId: string,
): PlatformJobDetail {
  // 1、验证中心也可能返回 200，先检查官网已观察到的固定页面标题。
  if (/<title\b[^>]*>\s*安全中心\s*-\s*风险提示\s*<\/title\s*>/i.test(html))
    throw new PlatformError('access_blocked', 200, 'verification_required');
  const postings: unknown[] = [];
  // 2、只读取 JSON-LD 数据块；普通脚本、账号信息与推荐职位不参与正文解析。
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    let value: unknown;
    try {
      value = JSON.parse(match[1] ?? '');
    } catch {
      throw new LiepinParseError('detail_jsonld_invalid');
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      '@type' in value &&
      value['@type'] === 'JobPosting'
    )
      postings.push(value);
  }
  if (!postings.length) {
    // 官网明确展示暂停文案才跳过，脚本或注释中的模板文本不作为页面状态。
    const visibleMarkup = html.replace(
      /<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      '',
    );
    if (/>\s*该职位已暂停招聘\s*</.test(visibleMarkup)) throw new PlatformJobPaused();
    throw new LiepinParseError('detail_posting_missing');
  }
  if (postings.length > 1) throw new LiepinParseError('detail_posting_multiple');
  const parsed = postingSchema.safeParse(postings[0]);
  if (!parsed.success) throw new LiepinParseError('detail_posting_schema');
  const posting = parsed.data;
  // 3、公开 URL 与内部职位 ID 同时核验；公司名称一致仍不能代替公司 ID 一致。
  if (posting.identifier.value !== internalId) throw new LiepinParseError('detail_job_id');
  if (posting.url !== candidate.sourceUrl) throw new LiepinParseError('detail_url');
  if (posting.title !== candidate.title) throw new LiepinParseError('detail_title');
  const companyNameMatches = posting.hiringOrganization.name === candidate.company;
  const companyLink = posting.hiringOrganization.sameAs;
  if (!candidate.externalCompanyId) {
    // 3.a、无列表 ID 时，名称和无附加参数的官方公司链接必须同时匹配。
    const externalCompanyId = /^https:\/\/www\.liepin\.com\/company\/([1-9]\d*)\/$/.exec(
      companyLink ?? '',
    )?.[1];
    if (!externalCompanyId || !companyNameMatches) throw new PlatformCompanyIdentityUnavailable();
    return { ...candidate, externalCompanyId, description: posting.description };
  }
  if (companyLink == null) throw new LiepinParseError('detail_posting_schema');
  const companyUrlMatches =
    companyLink === `https://www.liepin.com/company/${candidate.externalCompanyId}/`;
  if (!companyUrlMatches) {
    // 相同 ID 的 URL 格式变化与确实出现不同公司 ID 分开报告。
    const companyUrl = URL.parse(companyLink);
    const detailCompanyId =
      companyUrl?.origin === 'https://www.liepin.com'
        ? /^\/company\/([1-9]\d*)\/?$/.exec(companyUrl.pathname)?.[1]
        : undefined;
    const companyIdDiffers =
      detailCompanyId !== undefined && detailCompanyId !== candidate.externalCompanyId;
    if (companyIdDiffers)
      throw new LiepinParseError(
        companyNameMatches ? 'detail_company_id' : 'detail_company_name_and_id',
      );
    throw new LiepinParseError(
      companyNameMatches ? 'detail_company_url' : 'detail_company_name_and_url',
    );
  }
  // 公司身份已由规范链接确认；列表展示名可能是简称，继续使用列表名称。
  return { ...candidate, description: posting.description };
}

/** 仅把重定向目标映射为固定原因码，绝不把 Location 或查询参数带入任务日志。 */
function redirectReason(location: string | null, sourceUrl: string): string {
  if (!location) return 'redirect_missing_location';
  let target: URL;
  try {
    target = new URL(location, sourceUrl);
  } catch {
    return 'redirect_invalid_location';
  }
  if (
    target.protocol !== 'https:' ||
    (target.hostname !== 'liepin.com' && !target.hostname.endsWith('.liepin.com'))
  )
    return 'redirect_external';
  const path = target.pathname.toLowerCase();
  const verification = liepinVerificationReason(target);
  if (verification) return verification;
  if (/(^|\/)(login|passport|signin|register)(\/|$)/.test(path)) return 'redirect_login';
  if (/(^|\/)(verify|verification|security|captcha|risk|safe)(\/|$)/.test(path))
    return 'redirect_challenge';
  if (/^\/(?:(job|a)\/[1-9]\d*\.shtml|lptjob\/[1-9]\d*)$/.test(path)) return 'redirect_job';
  return 'redirect_internal_other';
}

/** 猎聘固定条件的协议会话；输入来自官网浏览器响应或显式 HTTP。 */
export class LiepinRecommendationHttpSession implements PlatformSession {
  readonly #fetch: typeof fetch;
  readonly #pacer: PlatformRequestPacer;
  readonly #readHeaders:
    ((url: string, signal: AbortSignal) => Promise<Readonly<Record<string, string>>>) | undefined;
  readonly #browserResponse:
    ((url: string, list: boolean, signal: AbortSignal) => Promise<Response>) | undefined;
  #template: LiepinRecommendationTemplate | null;
  #closed = false;
  #busy = false;
  #consumed = false;
  readonly #search: boolean;
  #hasMore = true;
  readonly #seen = new Map<string, string>();
  readonly #abort = new AbortController();
  #candidates = new Map<string, PlatformCandidate>();
  #ids = new Map<string, string>();

  /** 上下文读取回调只能为传入的已校验目标提供适用字段；不得持久化凭据。 */
  public constructor(input: {
    template: LiepinRecommendationTemplate;
    readHeaders?: (url: string, signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
    browserResponse?: (url: string, list: boolean, signal: AbortSignal) => Promise<Response>;
    fetch?: typeof fetch;
    now?: () => number;
    requestIntervalMs?: number;
    /** 必须与浏览器实际搜索模板一致，不接受推荐流冒充关键词搜索。 */
    expectedKeyword?: string;
  }) {
    this.#search = input.expectedKeyword !== undefined;
    try {
      if (
        input.template.url !== (this.#search ? searchEndpoint : endpoint) ||
        input.template.body.length > 20000
      )
        throw new Error();
      if (this.#search) {
        const parsed = searchRequestSchema.parse(JSON.parse(input.template.body));
        if (
          parsed.data.mainSearchPcConditionForm.key !== input.expectedKeyword ||
          parsed.data.mainSearchPcConditionForm.currentPage !== 0
        )
          throw new Error();
      } else requestSchema.parse(JSON.parse(input.template.body));
    } catch {
      throw new LiepinParseError('template');
    }
    this.#template = { ...input.template };
    this.#readHeaders = input.readHeaders;
    this.#browserResponse = input.browserResponse;
    this.#fetch = input.fetch ?? fetch;
    // 1、间隔下限由 Worker 配置合成；连接器只执行传入值，不隐含平台常量。
    this.#pacer = new PlatformRequestPacer(input.requestIntervalMs, input.now);
  }

  /** 查询固定；搜索只推进普通页码并承接服务端上下文，推荐只修改续批类型。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#operation(signal, async (combined) => {
      if (!this.#hasMore || !this.#template || this.#seen.size >= 2000)
        throw new PlatformError('session_unavailable');
      // 1、不能重复首页冒充下一页，排序和求职条件始终保持首次模板值。
      const payload = this.#search
        ? searchRequestSchema.parse(JSON.parse(this.#template.body))
        : {
            data: {
              ...requestSchema.parse(JSON.parse(this.#template.body)).data,
              operateKind: this.#consumed ? 'UP' : 'LOGIN',
            },
          };
      const body = await this.#request(this.#template.url, JSON.stringify(payload), combined);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new LiepinParseError('body');
      }
      const envelope = z
        .object({ flag: z.number(), code: z.union([z.string(), z.number()]).optional() })
        .safeParse(raw);
      if (!envelope.success) throw new LiepinParseError('list_envelope');
      if (envelope.data.flag !== 1) {
        const code = Number(envelope.data.code);
        throw new PlatformError('upstream_error', Number.isSafeInteger(code) ? code : null);
      }
      // 1.a、搜索响应使用显式页码；推荐仍保持 LOGIN→UP，不能混用两个协议。
      let nextTemplate: string | undefined;
      let parsed: ReturnType<typeof parseList>;
      let pageIndex: number | undefined;
      if (this.#search) {
        const result = searchListSchema.safeParse(raw);
        if (!result.success) throw new LiepinParseError('list_schema');
        const request = searchRequestSchema.parse(payload);
        const { pagination, passThroughData, data } = result.data.data;
        const conditions = request.data.mainSearchPcConditionForm;
        pageIndex = conditions.currentPage;
        if (
          pagination.currentPage !== conditions.currentPage ||
          pagination.pageSize !== conditions.pageSize ||
          (pagination.totalPage > 0 && pagination.currentPage >= pagination.totalPage)
        )
          throw new LiepinParseError('list_pagination');
        // 官网分页控件依据 totalPage；真实首批 hasNext=false 但仍显示多个页码。
        parsed = parseList(
          {
            flag: 1,
            data: {
              data: data.jobCardList,
              addData: [],
              hasNextPage: pagination.currentPage + 1 < pagination.totalPage,
            },
          },
          pageIndex,
        );
        nextTemplate = JSON.stringify({
          data: {
            mainSearchPcConditionForm: { ...conditions, currentPage: conditions.currentPage + 1 },
            passThroughForm: { ...request.data.passThroughForm, ...passThroughData },
          },
        });
      } else parsed = parseList(raw);
      // 2、关键词续页可包含已见职位；只在身份一致且仍有新职位时推进。
      const newIds = new Map<string, string>();
      const evidence = {
        httpStatus: 200,
        ...(pageIndex === undefined ? {} : { pageIndex }),
        rowCount: parsed.ids.size,
      };
      let seenCount = 0;
      for (const [rowIndex, [key, internalId]] of [...parsed.ids].entries()) {
        const previous = this.#seen.get(key);
        if (previous === undefined) newIds.set(key, internalId);
        else {
          seenCount++;
          const identityEvidence = {
            ...evidence,
            rowIndex,
            externalJobId: key,
            previousInternalId: previous,
            receivedInternalId: internalId,
          };
          if (previous !== internalId)
            throw new LiepinParseError('list_identity_conflict', identityEvidence);
          if (!this.#search) throw new LiepinParseError('duplicate_list', identityEvidence);
        }
      }
      if (parsed.ids.size > 0 && newIds.size === 0)
        throw new LiepinParseError('duplicate_list', { ...evidence, seenCount });
      if (this.#seen.size + newIds.size > 2000) throw new PlatformError('session_unavailable');
      const candidates = parsed.batch.candidates.filter((candidate) =>
        newIds.has(candidate.externalJobId),
      );
      for (const [key, internalId] of newIds) this.#seen.set(key, internalId);
      this.#ids = newIds;
      this.#candidates = new Map(
        candidates.map((candidate) => [candidate.externalJobId, candidate]),
      );
      this.#consumed = true;
      if (nextTemplate) this.#template = { ...this.#template, body: nextTemplate };
      this.#hasMore = parsed.batch.hasMore;
      return {
        ...parsed.batch,
        candidates,
        skippedMissingCompanyId: newIds.size - candidates.length,
      };
    });
  }

  /** 仅当前批次已校验候选可以请求详情，不接收任意 URL。 */
  public async readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return this.#operation(signal, async (combined) => {
      const candidate = this.#candidates.get(externalJobId);
      const internalId = this.#ids.get(externalJobId);
      if (!candidate || !internalId) throw new PlatformError('session_unavailable');
      return parseDetail(
        await this.#request(candidate.sourceUrl, null, combined),
        candidate,
        internalId,
      );
    });
  }

  /** 释放本会话工作集；浏览器连接所有权仍由调用方持有。 */
  public disconnect(): void {
    this.#closed = true;
    this.#abort.abort();
    this.#template = null;
    this.#candidates.clear();
    this.#ids.clear();
    this.#seen.clear();
  }

  /** 串行、取消与失败冻结；仅详情 GET 在发送边界允许有界传输重试。 */
  async #operation<T>(
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.#closed || this.#busy || signal.aborted)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    try {
      // 1、HTTP 截止时间覆盖传输重试。网页导航在节流后启动自己的响应截止时间。
      const combined = AbortSignal.any([
        signal,
        this.#abort.signal,
        ...(this.#browserResponse ? [] : [AbortSignal.timeout(20_000)]),
      ]);
      const result = await action(combined);
      combined.throwIfAborted();
      return result;
    } catch (error) {
      const cancelled = isAborted(signal) || isAborted(this.#abort.signal);
      if (
        !cancelled &&
        (error instanceof PlatformJobPaused || error instanceof PlatformCompanyIdentityUnavailable)
      )
        throw error;
      this.disconnect();
      if (cancelled) throw new PlatformError('session_unavailable');
      if (error instanceof PlatformError) throw error;
      throw new LiepinNetworkError('operation', networkDiagnostic(error), 1);
    } finally {
      this.#busy = false;
    }
  }

  /** 只对已知瞬时传输故障重试详情 GET；有状态列表 POST 一律不重放。 */
  async #request(url: string, body: string | null, signal: AbortSignal): Promise<string> {
    if (this.#browserResponse) {
      clearPlatformResponse();
      return this.#readResponse(
        await this.#browserResponse(url, body !== null, signal),
        url,
        body,
        signal,
      );
    }
    // 1、每次失败重新读取适用认证头，不跨请求保留上下文。
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#requestAttempt(url, body, signal);
      } catch (error) {
        if (error instanceof PlatformError || signal.aborted) throw error;
        const diagnostic = networkDiagnostic(error);
        if (body === null && diagnostic.reason !== null && attempt < 3) {
          // 2、仅幂等 GET 做最多两次可取消退避，正常请求间隔仍由配置控制。
          await delay(attempt * 1000, undefined, { signal });
          continue;
        }
        throw new LiepinNetworkError(body === null ? 'detail' : 'list', diagnostic, attempt);
      }
    }
  }

  /** 固定目标、统一节流、有界正文；禁止自动重定向转发认证信息。 */
  async #requestAttempt(url: string, body: string | null, signal: AbortSignal): Promise<string> {
    // 1、只读当前目标适用上下文，实际 HTTP 由统一发送边界节流。
    if (!this.#readHeaders)
      throw new PlatformError('session_unavailable', null, 'auth_context_missing');
    const supplied = await this.#readHeaders(url, signal);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(supplied)) {
      const name = key.toLowerCase();
      if (!headerNames.has(name) || /[\r\n]/.test(value) || value.length > 32768)
        throw new LiepinParseError('template');
      if (body !== null || name === 'cookie') headers[name] = value;
    }
    headers.accept = body === null ? 'text/html' : 'application/json, text/plain, */*';
    if (body !== null) headers['content-type'] = 'application/json';
    signal.throwIfAborted();
    await this.#pacer.before(signal);
    clearPlatformResponse();
    const response = await this.#fetch(url, {
      method: body === null ? 'GET' : 'POST',
      headers,
      ...(body === null ? {} : { body }),
      redirect: 'manual',
      signal,
    });
    return this.#readResponse(response, url, body, signal);
  }

  /** 两种传输共享状态码、正文边界和原始响应诊断。 */
  async #readResponse(
    response: Response,
    url: string,
    body: string | null,
    signal: AbortSignal,
  ): Promise<string> {
    // 2、重定向／认证墙不当作正文；状态码与业务码分别分类。
    if (response.status !== 200) {
      const reason = [301, 302, 303, 307, 308].includes(response.status)
        ? redirectReason(response.headers.get('location'), url)
        : null;
      await discardPlatformResponse(response, signal);
      throw new PlatformError(
        response.status === 429
          ? 'rate_limited'
          : [301, 302, 303, 307, 308, 401, 403].includes(response.status)
            ? 'access_blocked'
            : 'upstream_error',
        response.status,
        reason,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (
      !(body === null ? /text\/html/i : /application\/json/i).test(contentType) ||
      !response.body
    ) {
      await discardPlatformResponse(response, signal);
      throw new LiepinParseError('body');
    }
    // 3、与请求共享截止信号；任何超限正文仅保留固定诊断。
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new LiepinParseError('body');
        chunks.push(value);
      }
      return platformResponseText(response, chunks);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
