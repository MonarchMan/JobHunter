import {
  PlatformError,
  type PlatformBatch,
  type PlatformCandidate,
  type PlatformJobDetail,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { cookieHeaderForUrl, type BrowserCookie } from './cookies.js';

const origin = 'https://www.zhipin.com';
const listPath = '/wapi/zpgeek/pc/recommend/job/list.json';
const detailPath = '/wapi/zpgeek/job/detail.json';
const identifier = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\w~-]+$/);
const text = z.string().trim().min(1).max(2_000);
const envelope = z.object({ code: z.number().int(), zpData: z.unknown().optional() });
const card = z.object({
  encryptJobId: identifier,
  encryptBrandId: z.union([identifier, z.literal('')]),
  securityId: z.string().min(1).max(8_192),
  lid: z.union([z.string(), z.number()]).optional(),
  jobName: text,
  brandName: text,
  cityName: text,
  salaryDesc: z.string().max(500),
  jobExperience: z.string().max(500),
  jobDegree: z.string().max(500),
});
const listSchema = z.object({
  hasMore: z.boolean(),
  lid: z.union([z.string(), z.number()]),
  jobList: z.array(card).max(100),
});
const detailSchema = z.object({
  jobInfo: z.object({
    encryptId: identifier,
    jobName: text,
    postDescription: z.string().trim().min(1).max(200_000),
  }),
});
const allowedQuery = new Set([
  'page',
  'pageSize',
  'city',
  'encryptExpectId',
  'mixExpectType',
  'expectInfo',
  'jobType',
  'salary',
  'experience',
  'degree',
  'industry',
  'scale',
  '_',
]);

/** 浏览器当前的最小认证上下文；不包含签名生成器或任意请求头。 */
interface BossRequestContext {
  readonly cookies: readonly BrowserCookie[];
  readonly token?: string;
}

/** 安全检查的脱敏现场；不持有上游正文、凭据或服务端未公开的根因判断。 */
class BossSecurityCheckError extends PlatformError {
  public constructor(input: {
    readonly transport: 'http' | 'browser';
    readonly endpoint: 'list' | 'detail';
    readonly request: number;
    readonly successes: number;
    readonly data: unknown;
  }) {
    super('access_blocked', 37);
    // 1、只输出固定字段存在性，禁止拼接任意上游键、message 或检查参数值。
    const fields = ['seed', 'name', 'ts'].filter(
      (key) =>
        input.data !== null && typeof input.data === 'object' && Object.hasOwn(input.data, key),
    );
    this.message += ` [boss:${input.transport}:${input.endpoint};request=${String(input.request)};priorCode0=${String(input.successes)};check=${fields.join('+') || 'none'};browserState=unknown]`;
  }
}

/** 认证头只接受有界可见 ASCII，拒绝换行注入，错误不包含凭据。 */
function authToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[\x21-\x7e]{1,8192}$/.test(value)) throw new PlatformError('session_unavailable');
  return value;
}

/** 内存候选访问上下文，不能通过公共结果泄露临时访问令牌。 */
interface DetailContext {
  readonly candidate: PlatformCandidate;
  readonly securityId: string;
  readonly lid: string;
}

/** BOSS 受限 HTTP 会话；不创建浏览器连接或持久化凭据，失败后冻结以避免继续访问。 */
export class BossHttpSession {
  #cookies: readonly BrowserCookie[];
  #token: string | undefined;
  #readContext: ((signal: AbortSignal) => Promise<BossRequestContext>) | undefined;
  readonly #template: URL;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #browserResponse:
    ((url: URL, signal: AbortSignal, jobId?: string) => Promise<Response>) | undefined;
  readonly #abort = new AbortController();
  readonly #details = new Map<string, DetailContext>();
  readonly #seen = new Set<string>();
  #page = 0;
  #hasMore = true;
  #busy = false;
  #lastRequestAt: number | null = null;
  #requestCount = 0;
  #successfulResponses = 0;

  public constructor(input: {
    readonly cookies: readonly BrowserCookie[];
    readonly observedListUrl: string;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
    readonly token?: string;
    readonly readContext?: (signal: AbortSignal) => Promise<BossRequestContext>;
    /** 显式浏览器模式只提供实际 JSON 响应；不走认证同步或 Node HTTP。 */
    readonly browserResponse?: (url: URL, signal: AbortSignal, jobId?: string) => Promise<Response>;
  }) {
    // 1、仅接受已经观察到的固定列表端点和已知查询字段，不允许任意网络代理。
    let url: URL;
    try {
      url = new URL(input.observedListUrl);
    } catch {
      throw new PlatformError('parse_changed');
    }
    if (
      url.origin !== origin ||
      url.pathname !== listPath ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].some((key) => !allowedQuery.has(key))
    )
      throw new PlatformError('parse_changed');
    // 2、复制会话数据，调用方后续修改不能扩大本会话授权范围。
    this.#template = url;
    this.#cookies = input.cookies.map((cookie) => ({ ...cookie }));
    this.#token = authToken(input.token);
    this.#readContext = input.readContext;
    this.#fetch = input.fetch ?? fetch;
    this.#now = input.now ?? Date.now;
    this.#browserResponse = input.browserResponse;
  }

  /** 断开会话中止在途请求并释放凭据，已返回业务事实不受影响。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#cookies = [];
    this.#token = undefined;
    this.#readContext = undefined;
    this.#details.clear();
    this.#seen.clear();
  }

  /** 用户每次调用只读一页，检查身份增量，绝不后台遍历。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#exclusive(async () => {
      // 1、工作集上限要求重新开始浏览，不能让私有上下文无界增长。
      if (this.#page >= 20) throw new PlatformError('session_unavailable');
      if (!this.#hasMore) return { candidates: [], hasMore: false };
      const url = new URL(this.#template);
      url.searchParams.set('page', String(this.#page + 1));
      url.searchParams.set('pageSize', '15');
      url.searchParams.set('_', String(this.#now()));
      const result = listSchema.safeParse(await this.#request(url, signal));
      if (!result.success) throw new PlatformError('parse_changed');
      // 2、重复批次和矛盾空结果不可伪装成正常末页。
      const rows = result.data.jobList;
      const ids = new Set(rows.map((row) => row.encryptJobId));
      if (
        ids.size !== rows.length ||
        (result.data.hasMore && rows.length === 0) ||
        (rows.length > 0 && rows.every((row) => this.#seen.has(row.encryptJobId)))
      )
        throw new PlatformError('parse_changed');
      const candidates: PlatformCandidate[] = [];
      let skippedMissingCompanyId = 0;
      for (const row of rows) {
        // 2.a、已知匿名公司缺少稳定身份，排除并计数，不以展示名称推测公司。
        if (row.encryptBrandId === '') {
          skippedMissingCompanyId += 1;
          this.#seen.add(row.encryptJobId);
          continue;
        }
        const candidate: PlatformCandidate = {
          externalJobId: row.encryptJobId,
          externalCompanyId: row.encryptBrandId,
          title: row.jobName,
          company: row.brandName,
          city: row.cityName,
          salary: row.salaryDesc,
          experience: row.jobExperience,
          education: row.jobDegree,
          sourceUrl: `${origin}/job_detail/${row.encryptJobId}.html`,
        };
        // 3、条目级 lid 优先，访问参数仅留当前会话；不使用浏览器旧详情模板。
        this.#details.set(row.encryptJobId, {
          candidate,
          securityId: row.securityId,
          lid: String(row.lid ?? result.data.lid),
        });
        if (!this.#seen.has(row.encryptJobId)) candidates.push(candidate);
        this.#seen.add(row.encryptJobId);
      }
      this.#page += 1;
      this.#hasMore = result.data.hasMore;
      return { candidates, hasMore: this.#hasMore, skippedMissingCompanyId };
    });
  }

  /** 只允许读取本次列表发现的职位，并核对身份及真实正文。 */
  public async readDetail(externalJobId: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return this.#exclusive(async () => {
      // 1、禁止调用方注入 securityId 或任意详情地址。
      const context = this.#details.get(externalJobId);
      if (!context) throw new PlatformError('session_unavailable');
      const url = new URL(detailPath, origin);
      url.searchParams.set('securityId', context.securityId);
      url.searchParams.set('lid', context.lid);
      url.searchParams.set('_', String(this.#now()));
      // 2、身份、标题、正文均通过后才返回可用于入库的事实。
      const result = detailSchema.safeParse(await this.#request(url, signal, externalJobId));
      if (
        !result.success ||
        result.data.jobInfo.encryptId !== externalJobId ||
        result.data.jobInfo.jobName !== context.candidate.title
      )
        throw new PlatformError('parse_changed');
      return { ...context.candidate, description: result.data.jobInfo.postDescription };
    });
  }

  /** 每个会话一次仅执行一个操作，访问受限或协议失败后禁止继续重试。 */
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.#abort.signal.aborted || this.#busy) throw new PlatformError('session_unavailable');
    this.#busy = true;
    try {
      return await work();
    } catch (error) {
      this.disconnect();
      throw error instanceof PlatformError ? error : new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 有界只读请求；不跟随重定向，不输出上游错误原文。 */
  async #request(url: URL, callerSignal: AbortSignal, jobId?: string): Promise<unknown> {
    // 1、同会话至少间隔五秒，等待和网络均响应取消。
    const signal = AbortSignal.any([callerSignal, this.#abort.signal, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    let delay =
      this.#lastRequestAt === null ? 0 : Math.max(0, 5_000 - (this.#now() - this.#lastRequestAt));
    while (delay > 0) {
      const { setTimeout } = await import('node:timers/promises');
      await setTimeout(delay, undefined, { signal });
      // 1.a、计时器可能提前唤醒；再次检查时钟，未满五秒不得发送。
      delay =
        this.#lastRequestAt === null ? 0 : Math.max(0, 5_000 - (this.#now() - this.#lastRequestAt));
    }
    // 1.a、模式在连接时固定；浏览器响应复用相同解析，不经过 Cookie 或 HTTP。
    let response: Response;
    if (this.#browserResponse) {
      this.#lastRequestAt = this.#now();
      this.#requestCount += 1;
      response = await this.#browserResponse(url, signal, jobId);
    } else {
      // 1.b、只同步浏览器已有上下文；失败或取消不允许沿用旧凭据继续访问。
      if (this.#readContext) {
        try {
          const context = await this.#readContext(signal);
          signal.throwIfAborted();
          this.#cookies = context.cookies.map((value) => ({ ...value }));
          this.#token = authToken(context.token);
        } catch {
          throw new PlatformError('session_unavailable');
        }
      }
      const cookie = cookieHeaderForUrl(this.#cookies, url, this.#now());
      if (!cookie) throw new PlatformError('session_unavailable');
      const headers: Record<string, string> = {
        Cookie: cookie,
        Accept: 'application/json',
        Referer: `${origin}/web/geek/jobs`,
        'X-Requested-With': 'XMLHttpRequest',
      };
      // 1.b、bst 必须来自适用 Cookie，不能使用其他域或已过期的认证字段。
      const bst = cookie
        .split('; ')
        .find((part) => part.startsWith('bst='))
        ?.slice(4);
      if (bst) {
        try {
          const value = authToken(decodeURIComponent(bst));
          if (value) headers.zp_token = value;
        } catch {
          throw new PlatformError('session_unavailable');
        }
      }
      if (this.#token) headers.token = this.#token;
      signal.throwIfAborted();
      this.#lastRequestAt = this.#now();
      // 1.c、等待和上下文读取完成后再生成普通缓存时间戳，与官网发送边界一致。
      url.searchParams.set('_', String(this.#lastRequestAt));
      this.#requestCount += 1;
      response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers,
      });
    }
    // 2、状态异常立即取消正文；最大两 MiB，避免任意响应占满内存。
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
        if (size > 2 * 1_024 * 1_024) throw new PlatformError('parse_changed');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    // 3、37 表示 SECURITY_CHECK，不等于未登录或某条已知触发规则，也不切换传输继续。
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new PlatformError('parse_changed');
    }
    const parsed = envelope.safeParse(raw);
    if (!parsed.success) throw new PlatformError('parse_changed');
    if (parsed.data.code === 37)
      throw new BossSecurityCheckError({
        transport: this.#browserResponse ? 'browser' : 'http',
        endpoint: url.pathname === listPath ? 'list' : 'detail',
        request: this.#requestCount,
        successes: this.#successfulResponses,
        data: parsed.data.zpData,
      });
    if (parsed.data.code !== 0) throw new PlatformError('upstream_error', parsed.data.code);
    signal.throwIfAborted();
    // 4、记录业务码成功，不冒充后续职位结构及身份校验也已通过。
    this.#successfulResponses += 1;
    return parsed.data.zpData;
  }
}
