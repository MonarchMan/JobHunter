import { setTimeout as delay } from 'node:timers/promises';
import {
  PlatformError,
  type PlatformBatch,
  type PlatformJobDetail,
  type PlatformSession,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { BossHttpSession } from './boss.js';

const origin = 'https://www.zhipin.com';
const listPath = '/wapi/zpgeek/pc/recommend/job/list.json';
const detailPath = '/wapi/zpgeek/job/detail.json';
const maxBytes = 2 * 1024 * 1024;
const eventSchema = z.object({
  sessionId: z.string().optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
});

/** 仅保留所选页已发出请求的关联信息；原始正文不进入持久层。 */
interface ObservedRequest {
  readonly url: URL;
  status?: number;
}

/** 一页尚未消费的真实响应；不通过刷新补齐历史记录。 */
interface ObservedPage {
  readonly url: URL;
  readonly response: Response;
  readonly observedAt: number;
}

/** BOSS 显式浏览器传输：正常页面动作产生 JSON，复用原协议和入库门槛。 */
export class BossBrowserSession implements PlatformSession {
  readonly #abort = new AbortController();
  readonly #requests = new Map<string, ObservedRequest>();
  readonly #remaining = new Set<string>();
  readonly #observedDetails = new Map<string, { response: Response; observedAt: number }>();
  #page: ObservedPage | undefined;
  #client: BossHttpSession | undefined;
  #query: string | undefined;
  #failure: PlatformError | undefined;
  #busy = false;
  #hasMore = true;
  #lastObservedAt = 0;
  #detail:
    | { securityId: string; resolve(response: Response): void; reject(error: unknown): void }
    | undefined;

  public constructor(
    private readonly input: {
      readonly sessionId: string;
      readonly call: (
        method: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<unknown>;
      /** 只能点击通过本批校验的稳定职位链接，不能调用私有页面方法。 */
      readonly clickJob: (jobId: string, signal: AbortSignal) => Promise<void>;
    },
  ) {}

  /** 释放观察正文及在途等待，但不拥有或关闭用户授权的 Socket。 */
  public disconnect(): void {
    this.#fail(new PlatformError('session_unavailable'));
  }

  /** 所有异常采用固定脱敏错误，并冻结当前代次；不得自动刷新恢复。 */
  #fail(error: PlatformError): void {
    if (this.#abort.signal.aborted) return;
    this.#failure = error;
    this.#abort.abort();
    this.#client?.disconnect();
    this.#requests.clear();
    this.#remaining.clear();
    this.#observedDetails.clear();
    this.#page = undefined;
    this.#detail?.reject(error);
    this.#detail = undefined;
  }

  /** 只接收选定页面的两类 GET 请求；异步正文失败在本会话内处理。 */
  public accept(raw: unknown): void {
    if (this.#abort.signal.aborted) return;
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sessionId !== this.input.sessionId) return;
    const { method, params } = parsed.data;
    try {
      // 1、主页面导航会使原批次失效，不能重新加载后继续使用旧候选。
      if (method === 'Page.frameNavigated') {
        const frame = z.object({ parentId: z.string().optional() }).parse(params.frame);
        if (!frame.parentId) this.#fail(new PlatformError('session_unavailable'));
        return;
      }
      // 2、只保留列表及当前详情的请求 ID；限制并发工作集。
      if (method === 'Network.requestWillBeSent') {
        const request = z
          .object({
            requestId: z.string(),
            redirectResponse: z.unknown().optional(),
            request: z.object({ url: z.string().max(32_768), method: z.string() }),
          })
          .parse(params);
        const url = new URL(request.request.url);
        if (url.origin !== origin || ![listPath, detailPath].includes(url.pathname)) return;
        this.#lastObservedAt = Date.now();
        if (request.request.method !== 'GET' || request.redirectResponse)
          throw new PlatformError('parse_changed');
        if (url.pathname === listPath) {
          if (
            this.#remaining.size > 0 ||
            this.#page ||
            [...this.#requests.values()].some((value) => value.url.pathname === listPath)
          )
            throw new PlatformError('session_unavailable');
          const query = new URLSearchParams(url.searchParams);
          query.delete('page');
          query.delete('_');
          query.sort();
          if (this.#query !== undefined && this.#query !== query.toString())
            throw new PlatformError('session_unavailable');
          this.#query = query.toString();
          this.#observedDetails.clear();
        } else if (
          this.#query === undefined ||
          (!this.#detail &&
            !this.#page &&
            this.#remaining.size === 0 &&
            ![...this.#requests.values()].some((value) => value.url.pathname === listPath))
        )
          return;
        if (this.#requests.size >= 8) throw new PlatformError('session_unavailable');
        this.#requests.set(request.requestId, { url });
      } else if (method === 'Network.responseReceived') {
        const response = z
          .object({
            requestId: z.string(),
            response: z.object({ status: z.number().int(), url: z.string() }),
          })
          .parse(params);
        const pending = this.#requests.get(response.requestId);
        if (pending) {
          if (response.response.url !== pending.url.href) throw new PlatformError('parse_changed');
          pending.status = response.response.status;
        }
      } else if (method === 'Network.loadingFinished') {
        const finished = z
          .object({ requestId: z.string(), encodedDataLength: z.number().optional() })
          .parse(params);
        const pending = this.#requests.get(finished.requestId);
        if (pending) {
          if ((finished.encodedDataLength ?? 0) > maxBytes)
            throw new PlatformError('parse_changed');
          void this.#finish(finished.requestId, pending);
        }
      } else if (
        method === 'Network.loadingFailed' &&
        typeof params.requestId === 'string' &&
        this.#requests.has(params.requestId)
      ) {
        throw new PlatformError('network_error');
      }
    } catch (error) {
      this.#fail(error instanceof PlatformError ? error : new PlatformError('parse_changed'));
    }
  }

  /** loadingFinished 后读取有界正文；不监听响应头或 Cookie。 */
  async #finish(requestId: string, request: ObservedRequest): Promise<void> {
    try {
      // 1、非成功状态无需读取正文，直接保留标准错误分类。
      const status = request.status;
      if (status !== 200)
        throw new PlatformError(
          status === 429 ? 'rate_limited' : status === 403 ? 'access_blocked' : 'upstream_error',
        );
      const result = z
        .object({ body: z.string().max(maxBytes * 2), base64Encoded: z.boolean() })
        .parse(
          await this.input.call(
            'Network.getResponseBody',
            { requestId },
            AbortSignal.any([this.#abort.signal, AbortSignal.timeout(10_000)]),
          ),
        );
      const bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
      if (bytes.length > maxBytes) throw new PlatformError('parse_changed');
      this.#abort.signal.throwIfAborted();
      // 2、风险响应立即冻结；业务内容仍由统一协议校验，不能用 DOM 摘要替代。
      const envelope = z
        .object({ code: z.number().int() })
        .parse(JSON.parse(bytes.toString('utf8')) as unknown);
      if (envelope.code !== 0)
        throw new PlatformError(
          envelope.code === 37 ? 'access_blocked' : 'upstream_error',
          envelope.code,
        );
      const response = new Response(bytes, { status: 200 });
      if (request.url.pathname === listPath)
        this.#page = { url: request.url, response, observedAt: Date.now() };
      else {
        const securityId = request.url.searchParams.get('securityId');
        if (!securityId) throw new PlatformError('parse_changed');
        if (this.#detail?.securityId === securityId) this.#detail.resolve(response);
        else {
          // 2.a、官网可能自动打开首条；仅复用同轮实际响应，避免重复点击已选职位。
          if (this.#observedDetails.size >= 3) {
            const oldest = this.#observedDetails.keys().next().value;
            if (oldest) this.#observedDetails.delete(oldest);
          }
          this.#observedDetails.set(securityId, { response, observedAt: Date.now() });
        }
      }
    } catch (error) {
      this.#fail(error instanceof PlatformError ? error : new PlatformError('parse_changed'));
    } finally {
      this.#requests.delete(requestId);
    }
  }

  /** 首次必须消费连接后观察到的第一页；后续页不得跳页或更换查询。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#exclusive(signal, async (operationSignal) => {
      operationSignal.throwIfAborted();
      if (this.#remaining.size > 0) throw new PlatformError('session_unavailable');
      if (!this.#hasMore) return { candidates: [], hasMore: false };
      // 1、有界等待正常筛选产生的列表，不触发页面加载。
      while (!this.#page) await delay(50, undefined, { signal: operationSignal });
      if (!this.#client) {
        this.#client = new BossHttpSession({
          cookies: [],
          observedListUrl: this.#page.url.href,
          browserResponse: (url, requestSignal, jobId) => this.#response(url, requestSignal, jobId),
        });
      }
      // 2、原解析器检查重复、公司身份及分页矛盾；记录可点击的当前批次。
      const batch = await this.#client.readNext(operationSignal);
      this.#hasMore = batch.hasMore;
      this.#remaining.clear();
      for (const row of batch.candidates) this.#remaining.add(row.externalJobId);
      return batch;
    });
  }

  /** 只允许当前批次详情，正常点击后等待同请求的真实 JSON。 */
  public async readDetail(id: string, signal: AbortSignal): Promise<PlatformJobDetail> {
    return this.#exclusive(signal, async (operationSignal) => {
      if (!this.#client || !this.#remaining.has(id)) throw new PlatformError('session_unavailable');
      const detail = await this.#client.readDetail(id, operationSignal);
      this.#remaining.delete(id);
      return detail;
    });
  }

  /** 将观察响应交给协议层；详情观察器须先于点击建立，防止漏掉快速响应。 */
  async #response(url: URL, signal: AbortSignal, jobId?: string): Promise<Response> {
    if (!jobId) {
      const page = this.#page;
      if (
        !page ||
        Date.now() - page.observedAt > 120_000 ||
        page.url.searchParams.get('page') !== url.searchParams.get('page')
      )
        throw new PlatformError('parse_changed');
      this.#page = undefined;
      return page.response;
    }
    const securityId = url.searchParams.get('securityId') ?? '';
    const observed = this.#observedDetails.get(securityId);
    this.#observedDetails.delete(securityId);
    if (observed && Date.now() - observed.observedAt <= 120_000) return observed.response;
    // 1、观察到的官网附带请求也会延后下一次主动点击，但不控制官网内部频率。
    while (Date.now() - this.#lastObservedAt < 5000)
      await delay(5000 - (Date.now() - this.#lastObservedAt), undefined, { signal });
    signal.throwIfAborted();
    const response = new Promise<Response>((resolve, reject) => {
      this.#detail = { securityId, resolve, reject };
    });
    // 2、立即登记拒绝处理，防止点击期间的取消产生未处理拒绝。
    void response.catch(() => undefined);
    const cancel = (): void => {
      this.#detail?.reject(new PlatformError('session_unavailable'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await this.input.clickJob(jobId, signal);
      signal.throwIfAborted();
      return await response;
    } finally {
      signal.removeEventListener('abort', cancel);
      this.#detail = undefined;
    }
  }

  /** 取消或任何失败即冻结；不关闭底层授权连接，不重试上游请求。 */
  async #exclusive<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const initialFailure = this.#currentFailure();
    if (initialFailure) throw initialFailure;
    if (this.#busy) throw new PlatformError('session_unavailable');
    this.#busy = true;
    const operationSignal = AbortSignal.any([
      signal,
      this.#abort.signal,
      AbortSignal.timeout(20_000),
    ]);
    try {
      return await work(operationSignal);
    } catch (error) {
      const failure =
        this.#currentFailure() ??
        (operationSignal.aborted
          ? new PlatformError('session_unavailable')
          : error instanceof PlatformError
            ? error
            : new PlatformError('session_unavailable'));
      this.#fail(failure);
      throw failure;
    } finally {
      this.#busy = false;
    }
  }

  /** 异步观察可在 await 期间改变错误；每次读取实时状态，避免静态窄化。 */
  #currentFailure(): PlatformError | undefined {
    return this.#failure;
  }
}
