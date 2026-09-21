import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  PlatformError,
  type PlatformSession,
  type PlatformBatch,
  type PlatformJobDetail,
} from '@jobhunter/platform-core';

const endpoint = 'https://we.51job.com/api/job/search-pc';
const queryKeys = new Set(
  'api_key timestamp keyword searchType function industry jobArea jobArea2 landmark metro salary workYear degree companyType companySize jobType issueDate sortType pageNum requestId keywordType pageSize source accountId pageCode scene decode__1048'.split(
    ' ',
  ),
);
const dynamicKeys = new Set(['timestamp', 'pageNum', 'requestId', 'decode__1048']);
const headerKeys = new Set(
  'sec-ch-ua-platform sign referer partner property sec-ch-ua sec-ch-ua-mobile uuid user-token account-id user-agent accept from-domain accept-language cookie priority sec-fetch-dest sec-fetch-mode sec-fetch-site'.split(
    ' ',
  ),
);
const identifier = z
  .union([z.string().regex(/^\d+$/), z.number().int().positive()])
  .transform(String);
const text = z.string().max(2000);
const row = z.object({
  jobId: identifier,
  coId: z.union([identifier, z.literal(''), z.null()]).optional(),
  jobName: text.min(1),
  companyName: text.min(1),
  jobAreaString: text,
  provideSalaryString: text,
  workYearString: text,
  degreeString: text,
  jobHref: z.string().max(4096),
  jobDescribe: z
    .string()
    .trim()
    .min(1)
    .max(200_000)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value)),
});
const body = z.object({
  job: z.object({ items: z.array(row).max(20), totalCount: z.number().int().nonnegative() }),
});

/** 固定失败阶段，不允许将原始响应、字段值或请求地址带入诊断。 */
type Job51ParseStage =
  | 'request_template'
  | 'query_changed'
  | 'content_type'
  | 'missing_body'
  | 'body_limit'
  | 'json'
  | 'envelope'
  | 'job_schema'
  | 'pagination'
  | 'detail_url'
  | 'detail_identity';

/** 保持统一失败类别，同时让任务记录可区分具体校验阶段。 */
class Job51ParseError extends PlatformError {
  public constructor(public readonly stage: Job51ParseStage) {
    super('parse_changed', null, stage);
    this.message = `${this.message} [51job:${stage}]`;
  }
}

/** 官网当前页已观察的原始请求；只留内存，禁止写任务或日志。 */
export interface Job51RequestTemplate {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** 固定端点与字段校验，原始签名与参数顺序不被重建。 */
function checkedTemplate(input: Job51RequestTemplate): {
  template: Job51RequestTemplate;
  page: number;
  fingerprint: string;
} {
  // 1、拒绝任意地址、重复字段及未知字段，避免凭据被带向其他资源。
  const url = new URL(input.url);
  if (
    `${url.origin}${url.pathname}` !== endpoint ||
    url.username ||
    url.password ||
    url.hash ||
    input.url.length > 32768
  )
    throw new Error('Invalid URL');
  for (const key of url.searchParams.keys())
    if (!queryKeys.has(key) || url.searchParams.getAll(key).length !== 1)
      throw new Error('Unknown query');
  const page = Number(url.searchParams.get('pageNum'));
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    url.searchParams.get('pageSize') !== '20' ||
    url.searchParams.get('api_key') !== '51job'
  )
    throw new Error('Invalid page');
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    const name = key.toLowerCase();
    if (
      name.startsWith(':') ||
      ['host', 'connection', 'content-length', 'accept-encoding'].includes(name)
    )
      continue;
    if (
      !headerKeys.has(name) ||
      typeof value !== 'string' ||
      value.length > 32768 ||
      /[\r\n]/.test(value)
    )
      throw new Error('Invalid header');
    headers[name] = value;
  }
  // 2、查询身份不包含页码与访问参数；账号切换同样不能混入当前工作集。
  const fingerprint = JSON.stringify(
    [...url.searchParams]
      .filter(([k]) => !dynamicKeys.has(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return { template: { url: input.url, headers }, page, fingerprint };
}

/** 前程无忧仅消费用户官网操作产生的批次，JSON 完整正文复用于详情。 */
export class Job51HttpSession implements PlatformSession {
  #template: ReturnType<typeof checkedTemplate> | undefined;
  #fingerprint: string | undefined;
  #page = 0;
  #count = 0;
  #ended = false;
  #busy = false;
  #failure: PlatformError | undefined;
  #lastAt = 0;
  readonly #abort = new AbortController();
  readonly #details = new Map<string, PlatformJobDetail>();
  readonly #seen = new Set<string>();
  readonly #fetch: typeof fetch;

  public constructor(input: { readonly fetch?: typeof fetch } = {}) {
    this.#fetch = input.fetch ?? fetch;
  }

  /** 观察器在冻结后不再收集认证数据，连接本身仍可保留至显式断开。 */
  public get active(): boolean {
    return !this.#abort.signal.aborted;
  }

  /** 只接收最新成功模板，不自动发 HTTP；同页重复监听不会增加请求。 */
  public offer(input: Job51RequestTemplate): void {
    if (this.#abort.signal.aborted || this.#ended) return;
    try {
      const next = checkedTemplate(input);
      if (this.#fingerprint !== undefined && this.#fingerprint !== next.fingerprint)
        throw new Job51ParseError('query_changed');
      if (next.page <= this.#page) return;
      this.#fingerprint = next.fingerprint;
      this.#template = next;
    } catch (error) {
      this.fail(error instanceof Job51ParseError ? error : new Job51ParseError('request_template'));
    }
  }

  /** 页面失效或观察到访问失败时冻结，不替用户刷新或重连。 */
  public fail(error: PlatformError): void {
    this.#failure = error;
    this.disconnect();
  }

  /** 用户显式读取；最多等待 90 秒官网新模板，未就绪不伪造末页。 */
  public async readNext(caller: AbortSignal): Promise<PlatformBatch> {
    if (this.#failure) throw this.#failure;
    if (this.#busy || this.#abort.signal.aborted || caller.aborted)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    const signal = AbortSignal.any([caller, this.#abort.signal, AbortSignal.timeout(90_000)]);
    try {
      // 1、末页无需再请求；本地上限不能被当作完整来源覆盖。
      if (this.#ended) return { candidates: [], hasMore: false };
      if (this.#count >= 20) throw new PlatformError('session_unavailable');
      while (!this.#template) await delay(100, undefined, { signal });
      const selected = this.#template;
      this.#template = undefined;
      const remaining = Math.max(0, 5000 - (Date.now() - this.#lastAt));
      if (remaining) await delay(remaining, undefined, { signal });
      signal.throwIfAborted();
      this.#lastAt = Date.now();
      // 2、原样发送已观察 URL，禁止跳转、自动重试或修改签名。
      const active = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
      const response = await this.#fetch(selected.template.url, {
        headers: selected.template.headers,
        signal: active,
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
        throw new Job51ParseError('content_type');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Job51ParseError('missing_body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          active.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) throw new Job51ParseError('body_limit');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      let raw: unknown;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Job51ParseError('json');
      }
      const envelope = z
        .object({ status: z.string(), resultbody: z.unknown().optional() })
        .safeParse(raw);
      if (!envelope.success) throw new Job51ParseError('envelope');
      if (envelope.data.status !== '1') throw new PlatformError('upstream_error');
      const parsed = body.safeParse(envelope.data.resultbody);
      if (!parsed.success) throw new Job51ParseError('job_schema');
      const { items, totalCount } = parsed.data.job;
      if (
        new Set(items.map((i) => i.jobId)).size !== items.length ||
        (items.length > 0 && items.every((i) => this.#seen.has(i.jobId))) ||
        (items.length === 0 && totalCount > 0) ||
        (selected.page - 1) * 20 + items.length > totalCount ||
        (selected.page * 20 < totalCount && items.length !== 20)
      )
        throw new Job51ParseError('pagination');
      // 3、稳定身份与正文校验后仅投影职位字段，不留招聘者与定位等无关资料。
      const candidates: PlatformBatch['candidates'][number][] = [];
      let skippedMissingCompanyId = 0;
      for (const item of items) {
        this.#seen.add(item.jobId);
        if (!item.coId) {
          skippedMissingCompanyId++;
          continue;
        }
        let url: URL;
        try {
          url = new URL(item.jobHref);
        } catch {
          throw new Job51ParseError('detail_url');
        }
        if (
          url.origin !== 'https://jobs.51job.com' ||
          url.username ||
          url.password ||
          !url.pathname.endsWith(`/${item.jobId}.html`)
        )
          throw new Job51ParseError('detail_url');
        url.search = '';
        url.hash = '';
        const detail: PlatformJobDetail = {
          externalJobId: item.jobId,
          externalCompanyId: item.coId,
          title: item.jobName,
          company: item.companyName,
          city: item.jobAreaString,
          salary: item.provideSalaryString,
          experience: item.workYearString,
          education: item.degreeString,
          sourceUrl: url.href,
          description: item.jobDescribe,
        };
        const old = this.#details.get(item.jobId);
        if (
          old &&
          (old.externalCompanyId !== detail.externalCompanyId ||
            old.title !== detail.title ||
            old.company !== detail.company)
        )
          throw new Job51ParseError('detail_identity');
        this.#details.set(item.jobId, detail);
        if (!old) {
          candidates.push({
            externalJobId: detail.externalJobId,
            externalCompanyId: detail.externalCompanyId,
            title: detail.title,
            company: detail.company,
            city: detail.city,
            salary: detail.salary,
            experience: detail.experience,
            education: detail.education,
            sourceUrl: detail.sourceUrl,
          });
        }
      }
      signal.throwIfAborted();
      this.#page = selected.page;
      this.#count++;
      this.#ended = selected.page * 20 >= totalCount;
      return { candidates, hasMore: !this.#ended, skippedMissingCompanyId };
    } catch (error) {
      const failure =
        this.#currentFailure() ??
        (error instanceof PlatformError
          ? error
          : new PlatformError(signal.aborted ? 'session_unavailable' : 'network_error'));
      this.fail(failure);
      throw failure;
    } finally {
      this.#busy = false;
    }
  }

  /** 只消费本次实时列表已校验的完整正文，不伪称重新读取详情接口。 */
  public readDetail(id: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return Promise.resolve().then(() => {
      if (signal.aborted || this.#abort.signal.aborted || this.#busy)
        throw this.#failure ?? new PlatformError('session_unavailable');
      const detail = this.#details.get(id);
      if (!detail) throw new PlatformError('session_unavailable');
      return { ...detail };
    });
  }

  /** 异步请求期间观察器也可能冻结会话，因此在 catch 时重新读取错误。 */
  #currentFailure(): PlatformError | undefined {
    return this.#failure;
  }

  /** 清理凭据与候选，浏览器连接仍由外层拥有。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#template = undefined;
    this.#fingerprint = undefined;
    this.#details.clear();
    this.#seen.clear();
  }
}
