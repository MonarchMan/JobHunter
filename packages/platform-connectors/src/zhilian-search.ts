import { setTimeout as delay } from 'node:timers/promises';
import {
  PlatformError,
  type PlatformSession,
  type PlatformBatch,
  type PlatformCandidate,
  type PlatformJobDetail,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { campusDescription } from './zhilian.js';
import type { ZhilianCampusRequestTemplate } from './zhilian-recommend.js';

const origin = 'https://fe-api.zhaopin.com';
const listPath = '/c/i/search/positions';
const detailPath = '/c/i/jobs/position-detailv3';
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/);
const text = z.string().max(2_000);
const token = z.string().min(1).max(8_192);
const bodySchema = z
  .object({
    S_SOU_FULL_INDEX: text,
    S_SOU_WORK_CITY: text,
    S_SOU_WORK_EXPERIENCE: text.optional(),
    order: z.literal(0),
    actionid: id,
    pageSize: z.literal(20),
    pageIndex: z.literal(1),
    cvNumber: token,
    at: token,
    rt: token,
    eventScenario: z.literal('pcSearchedSouSearch'),
    anonymous: z.literal(0),
    resumeNumber: token,
    clickFilterBlackCompany: z.boolean(),
    platform: z.literal(13),
    version: z.literal('0.0.0'),
    sortType: z.literal('DEFAULT'),
  })
  .strict();
const rowSchema = z.object({
  number: id,
  name: text.min(1),
  companyNumber: z.union([id, z.literal('')]),
  companyName: text.min(1),
  workCity: text.min(1),
  salary60: text,
  education: text,
  workingExp: text,
});
const envelopeSchema = z.object({
  code: z.number().int(),
  apiCode: z.number().int(),
  data: z.unknown(),
});
const batchSchema = z.object({
  statusCode: z.number().int(),
  isVerification: z.number().int(),
  count: z.number().int().nonnegative(),
  isEndPage: z.union([z.literal(0), z.literal(1)]),
  list: z.array(rowSchema).max(20),
});
const detailSchema = z.object({
  detailedPosition: z.object({
    positionNumber: id,
    positionName: text.min(1),
    positionWorkCity: text.min(1),
    positionWorkingExp: text,
    salary: text,
    education: text,
    jobDesc: z.string().trim().min(1).max(200_000),
  }),
  detailedCompany: z.object({ companyNumber: id, companyName: text.min(1) }),
});
const headerKeys = new Set([
  'sec-ch-ua-platform',
  'x-zp-business-system',
  'referer',
  'sec-ch-ua',
  'x-zp-page-code',
  'sec-ch-ua-mobile',
  'x-zp-platform',
  'user-agent',
  'accept',
  'content-type',
  'accept-language',
  'origin',
  'priority',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
]);
const queryKeys = [
  'at',
  'rt',
  'platform',
  'version',
  '_v',
  'x-zp-page-request-id',
  'x-zp-client-id',
];

/** 同一官网搜索页观察的双模板；仅驻留 Worker 内存，禁止持久化。 */
export interface ZhilianSearchTemplates {
  readonly list: ZhilianCampusRequestTemplate;
  readonly detail: { readonly url: string; readonly headers: Readonly<Record<string, string>> };
}

/** 只允许已观察端点／字段，保留原始重复参数，拒绝认证上下文混用。 */
function checkedUrl(raw: string, path: string, body: z.infer<typeof bodySchema>): URL {
  const url = new URL(raw);
  const allowed =
    path === detailPath
      ? [...queryKeys, 'number', 'cvNumber', 'resumeNumber', 'identity']
      : queryKeys;
  if (
    url.origin !== origin ||
    url.pathname !== path ||
    url.username ||
    url.password ||
    url.hash ||
    raw.length > 32768 ||
    [...url.searchParams.keys()].some((k) => !allowed.includes(k))
  )
    throw new Error('Invalid template');
  // 1、认证和协议常量必须单值且与同次搜索正文一致。
  const expected: Record<string, string> = {
    at: body.at,
    rt: body.rt,
    platform: '13',
    version: '0.0.0',
  };
  if (path === detailPath)
    Object.assign(expected, {
      cvNumber: body.cvNumber,
      resumeNumber: body.resumeNumber,
      identity: '1',
    });
  for (const [key, value] of Object.entries(expected)) {
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)
      throw new Error('Inconsistent context');
  }
  if (
    path === detailPath &&
    (url.searchParams.getAll('number').length !== 1 ||
      !id.safeParse(url.searchParams.get('number')).success)
  )
    throw new Error('Invalid identity');
  return url;
}

/** 请求头仅保留已观察的只读协议上下文，明确丢弃 Cookie 和传输层字段。 */
function checkedHeaders(input: Readonly<Record<string, string>>): Record<string, string> {
  const output: Record<string, string> = {};
  // 1、模板不是可信输入，不允许未声明头或换行注入。
  for (const [key, value] of Object.entries(input)) {
    const name = key.toLowerCase();
    if (
      name === 'cookie' ||
      name.startsWith(':') ||
      ['host', 'content-length', 'accept-encoding', 'connection'].includes(name)
    )
      continue;
    if (
      !headerKeys.has(name) ||
      typeof value !== 'string' ||
      value.length > 16384 ||
      /[\r\n]/.test(value)
    )
      throw new Error('Invalid header');
    output[name] = value;
  }
  if (output['x-zp-platform'] !== '13' || output['x-zp-business-system'] !== '1')
    throw new Error('Wrong platform');
  output.origin = 'https://www.zhaopin.com';
  output.referer = 'https://www.zhaopin.com/';
  output['content-type'] = 'application/json';
  return output;
}

/** 主站搜索和详情使用独立 HTTP；查询在连接时固定，不自动跟随浏览器变化。 */
export class ZhilianSearchHttpSession implements PlatformSession {
  #body: z.infer<typeof bodySchema> | null;
  #listUrl: URL | null;
  #detailUrl: URL | null;
  #listHeaders: Record<string, string>;
  #detailHeaders: Record<string, string>;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #abort = new AbortController();
  readonly #candidates = new Map<string, PlatformCandidate>();
  readonly #seen = new Set<string>();
  #page = 0;
  #hasMore = true;
  #busy = false;
  #lastAt: number | null = null;

  public constructor(input: {
    readonly templates: ZhilianSearchTemplates;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
  }) {
    // 1、模板边界错误只报告分类，不把 URL／令牌带入异常。
    try {
      if (input.templates.list.body.length > 32768) throw new Error('Oversized template');
      this.#body = bodySchema.parse(JSON.parse(input.templates.list.body));
      this.#listUrl = checkedUrl(input.templates.list.url, listPath, this.#body);
      this.#detailUrl = checkedUrl(input.templates.detail.url, detailPath, this.#body);
      this.#listHeaders = checkedHeaders(input.templates.list.headers);
      this.#detailHeaders = checkedHeaders(input.templates.detail.headers);
    } catch {
      throw new PlatformError('parse_changed');
    }
    this.#fetch = input.fetch ?? fetch;
    this.#now = input.now ?? Date.now;
  }

  /** 显式读取一页，结束信号与本地 20 页安全上限分开处理。 */
  public readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#run(signal, async (active) => {
      // 1、真实末页不再请求；本地上限不伪造成上游结束。
      if (!this.#hasMore) return { candidates: [], hasMore: false };
      if (!this.#body || !this.#listUrl || this.#page >= 20)
        throw new PlatformError('session_unavailable');
      const data = await this.#request(
        this.#listUrl,
        this.#listHeaders,
        { ...this.#body, pageIndex: this.#page + 1 },
        active,
      );
      const parsed = batchSchema.safeParse(data);
      if (!parsed.success) throw new PlatformError('parse_changed');
      const batch = parsed.data;
      if (batch.isVerification !== 0) throw new PlatformError('access_blocked');
      if (batch.statusCode !== 200) throw new PlatformError('upstream_error', batch.statusCode);
      const rows = batch.list;
      if (
        new Set(rows.map((r) => r.number)).size !== rows.length ||
        (!rows.length && batch.isEndPage === 0) ||
        (rows.length > 0 && rows.every((r) => this.#seen.has(r.number))) ||
        batch.count < rows.length
      )
        throw new PlatformError('parse_changed');
      // 2、缺少公司编号的已知条目计数排除；未知结构拒绝，跨页部分重叠去重。
      const candidates: PlatformCandidate[] = [];
      let skippedMissingCompanyId = 0;
      for (const row of rows) {
        this.#seen.add(row.number);
        if (!row.companyNumber) {
          skippedMissingCompanyId++;
          continue;
        }
        const candidate: PlatformCandidate = {
          externalJobId: row.number,
          externalCompanyId: row.companyNumber,
          title: row.name,
          company: row.companyName,
          city: row.workCity,
          salary: row.salary60,
          experience: row.workingExp,
          education: row.education,
          sourceUrl: `https://www.zhaopin.com/jobdetail/${row.number}.htm`,
        };
        const previous = this.#candidates.get(row.number);
        if (
          previous &&
          (previous.externalCompanyId !== candidate.externalCompanyId ||
            previous.title !== candidate.title ||
            previous.company !== candidate.company)
        )
          throw new PlatformError('parse_changed');
        if (!previous) candidates.push(candidate);
        this.#candidates.set(row.number, candidate);
      }
      this.#page++;
      this.#hasMore = batch.isEndPage === 0;
      return { candidates, hasMore: this.#hasMore, skippedMissingCompanyId };
    });
  }

  /** 详情只允许本次工作集中的编号，正文不能来自列表摘要或浏览器响应重放。 */
  public readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return this.#run(signal, async (active) => {
      // 1、从内存候选取得身份，只替换已观察详情模板的职位编号。
      const candidate = this.#candidates.get(externalJobId);
      if (!candidate || !this.#detailUrl) throw new PlatformError('session_unavailable');
      const url = new URL(this.#detailUrl);
      url.searchParams.set('number', externalJobId);
      const parsed = detailSchema.safeParse(
        await this.#request(url, this.#detailHeaders, undefined, active),
      );
      if (!parsed.success) throw new PlatformError('parse_changed');
      const { detailedPosition: job, detailedCompany: company } = parsed.data;
      if (
        job.positionNumber !== externalJobId ||
        job.positionName !== candidate.title ||
        company.companyNumber !== candidate.externalCompanyId ||
        company.companyName !== candidate.company
      )
        throw new PlatformError('parse_changed');
      // 2、JSON 的 jobDesc 含有限 HTML 排版，仅转为纯文本，绝不执行脚本。
      return {
        ...candidate,
        city: job.positionWorkCity,
        salary: job.salary,
        experience: job.positionWorkingExp,
        education: job.education,
        description: campusDescription(job.jobDesc, true),
      };
    });
  }

  /** 释放私有上下文并中断请求；CDP 所有权仍由外层活动连接管理。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#body = null;
    this.#listUrl = null;
    this.#detailUrl = null;
    this.#listHeaders = {};
    this.#detailHeaders = {};
    this.#candidates.clear();
    this.#seen.clear();
  }

  /** 串行及 5 秒间隔是保守实验策略；任一失败冻结，不重试或回退浏览器。 */
  async #run<T>(caller: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (caller.aborted || this.#abort.signal.aborted || this.#busy)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    const signal = AbortSignal.any([caller, this.#abort.signal]);
    try {
      // 1、等待可取消；间隔计于真实上游请求开始，而不是本地空结果动作。
      const remaining =
        this.#lastAt === null ? 0 : Math.max(0, 5000 - (this.#now() - this.#lastAt));
      if (remaining) await delay(remaining, undefined, { signal });
      signal.throwIfAborted();
      const result = await work(signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      this.disconnect();
      throw error instanceof PlatformError ? error : new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 固定只读端点，20 秒／2 MiB 上限，HTML、跳转和未知业务码均拒绝。 */
  async #request(
    url: URL,
    headers: Record<string, string>,
    body: unknown,
    caller: AbortSignal,
  ): Promise<unknown> {
    // 1、外部 IO 在事务之外；响应和异常不向日志暴露原始内容。
    const signal = AbortSignal.any([caller, AbortSignal.timeout(20_000)]);
    this.#lastAt = this.#now();
    const response = await this.#fetch(url.href, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      redirect: 'manual',
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PlatformError(
        response.status === 429
          ? 'rate_limited'
          : response.status === 403
            ? 'access_blocked'
            : 'upstream_error',
      );
    }
    if (!response.headers.get('content-type')?.includes('json')) {
      await response.body?.cancel();
      throw new PlatformError('parse_changed');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PlatformError('parse_changed');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new PlatformError('parse_changed');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    // 2、封装码和详情／列表数据分别校验，业务失败不当空列表。
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new PlatformError('parse_changed');
    }
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) throw new PlatformError('parse_changed');
    if (parsed.data.code !== 200 || parsed.data.apiCode !== 200) {
      const code = parsed.data.code !== 200 ? parsed.data.code : parsed.data.apiCode;
      throw new PlatformError(code === 2024 ? 'access_blocked' : 'upstream_error', code);
    }
    return parsed.data.data;
  }
}
