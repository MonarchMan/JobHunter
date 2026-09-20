import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  PlatformError,
  type PlatformSession,
  type PlatformBatch,
  type PlatformCandidate,
  type PlatformJobDetail,
} from '@jobhunter/platform-core';
import type { BrowserCookie } from './cookies.js';

const endpoint = 'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new';
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
  hiringOrganization: z.object({ name: text.min(1), sameAs: z.string() }),
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
const headerNames = new Set(
  'accept content-type x-xsrf-token x-client-type x-requested-with x-fscp-std-info x-fscp-fe-version x-fscp-version x-fscp-trace-id x-fscp-bi-stat referer origin cookie'.split(
    ' ',
  ),
);

/** 异步期间 AbortSignal 可变化，每次读取当前状态。 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
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
  public constructor(stage: 'template' | 'list' | 'identity' | 'detail' | 'body') {
    super('parse_changed');
    this.message += ` [liepin:${stage}]`;
  }
}

/** 只接受官网已返回的稳定职位 URL；不同公开路径空间不合并身份。 */
function jobIdentity(value: string): string {
  const match = /^https:\/\/www\.liepin\.com\/(job|a)\/([1-9]\d*)\.shtml$/.exec(value);
  if (!match?.[1] || !match[2]) throw new LiepinParseError('identity');
  return `${match[1]}:${match[2]}`;
}

/** 将成功信封中的主推荐和补充推荐合并，未知结构不能当作末页。 */
function parseList(raw: unknown): { batch: PlatformBatch; ids: Map<string, string> } {
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) throw new LiepinParseError('list');
  const candidates: PlatformCandidate[] = [];
  const ids = new Map<string, string>();
  let skipped = 0;
  // 1、先核验所有原始身份，包含无公司身份的条目；重复不能静默去重掩盖协议变化。
  for (const row of [...parsed.data.data.data, ...parsed.data.data.addData]) {
    const externalJobId = jobIdentity(row.job.link);
    if (ids.has(externalJobId)) throw new LiepinParseError('identity');
    ids.set(externalJobId, row.job.jobId);
    if (!row.comp.compId) {
      skipped++;
      continue;
    }
    candidates.push({
      externalJobId,
      externalCompanyId: row.comp.compId,
      title: row.job.title,
      company: row.comp.compName,
      city: row.job.dq,
      salary: row.job.salary,
      experience: row.job.requireWorkYears ?? '',
      education: row.job.requireEduLevel,
      sourceUrl: row.job.link,
    });
  }
  if (!ids.size && parsed.data.data.hasNextPage) throw new LiepinParseError('list');
  return {
    batch: { candidates, hasMore: parsed.data.data.hasNextPage, skippedMissingCompanyId: skipped },
    ids,
  };
}

/** 解析 HTTP HTML 内的结构化职位 JSON，不执行脚本或使用渲染 DOM。 */
function parseDetail(
  html: string,
  candidate: PlatformCandidate,
  internalId: string,
): PlatformJobDetail {
  const postings: unknown[] = [];
  // 1、只读取 JSON-LD 数据块；普通脚本、账号信息与推荐职位不参与正文解析。
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    let value: unknown;
    try {
      value = JSON.parse(match[1] ?? '');
    } catch {
      throw new LiepinParseError('detail');
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      '@type' in value &&
      value['@type'] === 'JobPosting'
    )
      postings.push(value);
  }
  if (postings.length !== 1) throw new LiepinParseError('detail');
  const parsed = postingSchema.safeParse(postings[0]);
  if (!parsed.success) throw new LiepinParseError('detail');
  const posting = parsed.data;
  // 2、公开 URL 与内部职位 ID 同时核验；公司名称一致仍不能代替公司 ID 一致。
  if (
    posting.identifier.value !== internalId ||
    posting.url !== candidate.sourceUrl ||
    posting.title !== candidate.title ||
    posting.hiringOrganization.name !== candidate.company ||
    posting.hiringOrganization.sameAs !==
      `https://www.liepin.com/company/${candidate.externalCompanyId}/`
  )
    throw new LiepinParseError('identity');
  return { ...candidate, description: posting.description };
}

/** 猎聘固定条件的 HTTP 推荐流；每次显式读取一批，LOGIN 后以 UP 续批。 */
export class LiepinRecommendationHttpSession implements PlatformSession {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #readHeaders: (
    url: string,
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, string>>>;
  #template: LiepinRecommendationTemplate | null;
  #lastAt: number | null = null;
  #closed = false;
  #busy = false;
  #consumed = false;
  #hasMore = true;
  readonly #seen = new Set<string>();
  readonly #abort = new AbortController();
  #candidates = new Map<string, PlatformCandidate>();
  #ids = new Map<string, string>();

  /** 上下文读取回调只能为传入的已校验目标提供适用字段；不得持久化凭据。 */
  public constructor(input: {
    template: LiepinRecommendationTemplate;
    readHeaders: (url: string, signal: AbortSignal) => Promise<Readonly<Record<string, string>>>;
    fetch?: typeof fetch;
    now?: () => number;
  }) {
    try {
      if (input.template.url !== endpoint || input.template.body.length > 20000) throw new Error();
      requestSchema.parse(JSON.parse(input.template.body));
    } catch {
      throw new LiepinParseError('template');
    }
    this.#template = { ...input.template };
    this.#readHeaders = input.readHeaders;
    this.#fetch = input.fetch ?? fetch;
    this.#now = input.now ?? Date.now;
  }

  /** 原始查询固定，只修改官网已验证的普通续批操作类型，不生成私有游标。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#operation(signal, async (combined) => {
      if (!this.#hasMore || !this.#template || this.#seen.size >= 2000)
        throw new PlatformError('session_unavailable');
      // 1、不能原样重复 LOGIN 冒充下一页，排序和求职条件始终保持首次模板值。
      const request = requestSchema.parse(JSON.parse(this.#template.body));
      const payload = { data: { ...request.data, operateKind: this.#consumed ? 'UP' : 'LOGIN' } };
      const body = await this.#request(endpoint, JSON.stringify(payload), combined);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new LiepinParseError('body');
      }
      const envelope = z
        .object({ flag: z.number(), code: z.union([z.string(), z.number()]).optional() })
        .safeParse(raw);
      if (!envelope.success) throw new LiepinParseError('list');
      if (envelope.data.flag !== 1) {
        const code = Number(envelope.data.code);
        throw new PlatformError('upstream_error', Number.isSafeInteger(code) ? code : null);
      }
      const parsed = parseList(raw);
      // 2、全批核验成功后推进工作集；异常与重复批次不能覆盖已完成批次。
      for (const key of parsed.ids.keys())
        if (this.#seen.has(key)) throw new LiepinParseError('identity');
      if (this.#seen.size + parsed.ids.size > 2000) throw new PlatformError('session_unavailable');
      for (const key of parsed.ids.keys()) this.#seen.add(key);
      this.#ids = parsed.ids;
      this.#candidates = new Map(
        parsed.batch.candidates.map((candidate) => [candidate.externalJobId, candidate]),
      );
      this.#consumed = true;
      this.#hasMore = parsed.batch.hasMore;
      return parsed.batch;
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

  /** 串行、取消与失败冻结，错误不会触发浏览器回退或隐式重试。 */
  async #operation<T>(
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.#closed || this.#busy || signal.aborted)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    const combined = AbortSignal.any([signal, this.#abort.signal, AbortSignal.timeout(20000)]);
    try {
      const result = await action(combined);
      combined.throwIfAborted();
      return result;
    } catch (error) {
      const cancelled = isAborted(signal) || isAborted(this.#abort.signal);
      this.disconnect();
      if (cancelled) throw new PlatformError('session_unavailable');
      if (error instanceof PlatformError) throw error;
      throw new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 固定目标、五秒节流、有界正文；禁止自动重定向转发认证信息。 */
  async #request(url: string, body: string | null, signal: AbortSignal): Promise<string> {
    // 1、节流唤醒后复核，随后只读当前目标适用上下文。
    while (this.#lastAt !== null && this.#now() - this.#lastAt < 5000)
      await delay(5000 - (this.#now() - this.#lastAt), undefined, { signal });
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
    this.#lastAt = this.#now();
    const response = await this.#fetch(url, {
      method: body === null ? 'GET' : 'POST',
      headers,
      ...(body === null ? {} : { body }),
      redirect: 'manual',
      signal,
    });
    // 2、重定向／认证墙不当作正文；状态码与业务码分别分类。
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PlatformError(
        response.status === 429
          ? 'rate_limited'
          : [301, 302, 303, 307, 308, 401, 403].includes(response.status)
            ? 'access_blocked'
            : 'upstream_error',
        response.status,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (
      !(body === null ? /text\/html/i : /application\/json/i).test(contentType) ||
      !response.body
    ) {
      await response.body?.cancel();
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
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
