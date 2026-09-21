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
  readonly token?: string | undefined;
}

/** 仅标识可重试的 HTTP 状态；不保存响应正文或 URL。 */
class BossRetryableResponse extends PlatformError {
  public constructor(
    status: number,
    public readonly retryAfterMs: number,
  ) {
    super(status === 429 ? 'rate_limited' : 'upstream_error');
  }
}

/** 从有界异常链识别临时传输故障，不把任意 TypeError 当作网络波动。 */
function transientReason(error: unknown): string | undefined {
  const codes: Record<string, string> = {
    ECONNRESET: 'connection_reset',
    ETIMEDOUT: 'request_timeout',
    EAI_AGAIN: 'dns_error',
    UND_ERR_SOCKET: 'socket_closed',
    UND_ERR_CONNECT_TIMEOUT: 'connect_timeout',
    UND_ERR_HEADERS_TIMEOUT: 'headers_timeout',
    UND_ERR_BODY_TIMEOUT: 'body_timeout',
  };
  let current: unknown = error;
  // 1、仅遍历三层原始异常 cause，输出固定原因码，不输出异常文本。
  for (let i = 0; i < 3; i++) {
    if (!(current instanceof Error)) return undefined;
    if (current.name === 'TimeoutError') return 'request_timeout';
    if ('code' in current && typeof current.code === 'string' && Object.hasOwn(codes, current.code))
      return codes[current.code];
    current = current.cause;
  }
  return undefined;
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
    super('access_blocked', 37, 'security_check');
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
  #paused: { expiresAt: number; binding: string; securityToken: string } | undefined;
  #resumeCount = 0;
  #networkRetries = 0;
  #batchExpiresAt = 0;
  #pauseTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.#paused = undefined;
    clearTimeout(this.#pauseTimer);
  }

  /** 每段只在原认证绑定不变且官网已更新安全上下文时解冻，不请求职位。 */
  public async resume(signal: AbortSignal): Promise<void> {
    const paused = this.#paused;
    if (
      !paused ||
      this.#resumeCount >= 5 ||
      this.#busy ||
      this.#abort.signal.aborted ||
      !this.#readContext
    )
      throw new PlatformError('session_unavailable');
    if (this.#now() >= paused.expiresAt) {
      this.disconnect();
      throw new PlatformError('session_unavailable', null, 'resume_expired');
    }
    this.#busy = true;
    try {
      // 1、只读官网正常浏览后的上下文；不向浏览器回灌挑战参数或操作验证。
      const context = await this.#readContext(signal).catch(() => {
        throw new PlatformError('session_unavailable', null, 'context_read_failed');
      });
      signal.throwIfAborted();
      this.#abort.signal.throwIfAborted();
      const identity = this.#contextIdentity(context);
      if (identity?.binding !== paused.binding) {
        this.disconnect();
        throw new PlatformError(
          'session_unavailable',
          null,
          identity ? 'auth_binding_changed' : 'auth_context_missing',
        );
      }
      if (identity.securityToken === paused.securityToken)
        throw new PlatformError('session_unavailable', null, 'context_unchanged');
      // 2、校验通过才恢复发送上下文；同一批最多五次，未更新上下文不消耗次数。
      this.#cookies = context.cookies.map((value) => ({ ...value }));
      this.#token = authToken(context.token);
      this.#paused = undefined;
      clearTimeout(this.#pauseTimer);
      this.#resumeCount += 1;
    } catch (error) {
      // 3、只有上下文尚未更新允许稍后确认；取消、读取失败或身份变化立即释放待办。
      if (!(error instanceof PlatformError) || error.reason !== 'context_unchanged')
        this.disconnect();
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  /** 仅在内存比较当前详情域适用的认证绑定；缺失或歧义 Cookie 不允许恢复。 */
  #contextIdentity(
    context: BossRequestContext,
  ): { binding: string; securityToken: string } | undefined {
    const parts = cookieHeaderForUrl(
      context.cookies,
      new URL(detailPath, origin),
      this.#now(),
    ).split('; ');
    const values = ['wt2', 'bst', '__zp_stoken__'].map((name) =>
      parts.filter((part) => part.startsWith(`${name}=`)),
    );
    const [wt2, bst, security] = values;
    if (!context.token || wt2?.length !== 1 || bst?.length !== 1 || security?.length !== 1)
      return undefined;
    const securityToken = security[0]?.slice('__zp_stoken__='.length);
    if (!securityToken || wt2[0] === 'wt2=' || bst[0] === 'bst=') return undefined;
    // 1、bst 会在正常浏览时轮换，只验证存在性；稳定认证绑定变化仍拒绝沿用旧候选。
    return { binding: JSON.stringify([wt2[0], authToken(context.token)]), securityToken };
  }

  /** 用户每次调用只读一页，检查身份增量，绝不后台遍历。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#exclusive(async () => {
      // 1、工作集上限要求重新开始浏览，不能让私有上下文无界增长。
      if (this.#page >= 20) throw new PlatformError('session_unavailable');
      if (!this.#hasMore) return { candidates: [], hasMore: false };
      this.#resumeCount = 0;
      this.#networkRetries = 0;
      this.#batchExpiresAt = this.#now() + 600_000;
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

  /** 请求内部可能设置暂停标记，跨异步边界重新读取实际状态。 */
  #isPaused(): boolean {
    return this.#paused !== undefined;
  }

  /** 每个会话一次仅执行一个操作，访问受限或协议失败后禁止继续重试。 */
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.#abort.signal.aborted || this.#busy || this.#paused)
      throw new PlatformError('session_unavailable');
    this.#busy = true;
    try {
      return await work();
    } catch (error) {
      // 1、仅可恢复的详情安全检查保留原工作集，其余错误释放全部私有上下文。
      if (!this.#isPaused()) this.disconnect();
      throw error instanceof PlatformError ? error : new PlatformError('network_error');
    } finally {
      this.#busy = false;
    }
  }

  /** 临时传输故障在当前 GET 内重试，独立于安全上下文恢复，不返回半成品。 */
  async #request(url: URL, callerSignal: AbortSignal, jobId?: string): Promise<unknown> {
    for (;;) {
      try {
        return await this.#requestAttempt(url, callerSignal, jobId);
      } catch (error) {
        // 1、37／解析／认证错误不属于传输重试；取消和底层关闭始终优先。
        const reason = transientReason(error);
        const retryable = error instanceof BossRetryableResponse;
        if (
          this.#browserResponse ||
          callerSignal.aborted ||
          this.#abort.signal.aborted ||
          (!reason && !retryable)
        )
          throw error;
        const terminal =
          error instanceof PlatformError ? error : new PlatformError('network_error', null, reason);
        const delay = Math.max(
          5000 * 2 ** this.#networkRetries,
          retryable ? error.retryAfterMs : 0,
        );
        if (this.#networkRetries >= 3 || this.#now() + delay >= this.#batchExpiresAt)
          throw terminal;
        this.#networkRetries++;
        // 2、退避受原批次期限、取消和连接关闭约束；不刷新或操作浏览器。
        const signal = AbortSignal.any([
          callerSignal,
          this.#abort.signal,
          AbortSignal.timeout(Math.max(1, this.#batchExpiresAt - this.#now())),
        ]);
        const { setTimeout } = await import('node:timers/promises');
        await setTimeout(delay, undefined, { signal });
        if (this.#now() >= this.#batchExpiresAt) throw terminal;
      }
    }
  }

  /** 单次只读请求；不跟随重定向，不输出上游错误原文。 */
  async #requestAttempt(url: URL, callerSignal: AbortSignal, jobId?: string): Promise<unknown> {
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
      // 2.a、只对白名单状态解析服务器等待时间；过长等待由外层批次期限拒绝。
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        const value = response.headers.get('retry-after');
        const after =
          value && /^\d+$/.test(value)
            ? Number(value) * 1000
            : value
              ? Date.parse(value) - this.#now()
              : 0;
        throw new BossRetryableResponse(
          response.status,
          Number.isNaN(after) ? 0 : Math.max(0, after),
        );
      }
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
    if (parsed.data.code === 37) {
      // 3.a、仅 HTTP 详情允许有界暂停；列表错误、浏览器模式及恢复次数耗尽仍终止。
      const identity = this.#contextIdentity({ cookies: this.#cookies, token: this.#token });
      if (
        jobId &&
        this.#readContext &&
        !this.#browserResponse &&
        this.#resumeCount < 5 &&
        identity
      ) {
        this.#paused = { ...identity, expiresAt: this.#batchExpiresAt };
        // 3.a.i、私有工作集的释放期限同样固定在原批次，不随暂停次数延长。
        this.#pauseTimer = setTimeout(
          () => {
            this.disconnect();
          },
          Math.max(0, this.#batchExpiresAt - this.#now()),
        );
        this.#pauseTimer.unref();
        this.#cookies = [];
        this.#token = undefined;
      }
      throw new BossSecurityCheckError({
        transport: this.#browserResponse ? 'browser' : 'http',
        endpoint: url.pathname === listPath ? 'list' : 'detail',
        request: this.#requestCount,
        successes: this.#successfulResponses,
        data: parsed.data.zpData,
      });
    }
    if (parsed.data.code !== 0) throw new PlatformError('upstream_error', parsed.data.code);
    signal.throwIfAborted();
    // 4、记录业务码成功，不冒充后续职位结构及身份校验也已通过。
    this.#successfulResponses += 1;
    return parsed.data.zpData;
  }
}
