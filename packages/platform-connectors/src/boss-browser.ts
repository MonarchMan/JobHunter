import {
  PlatformError,
  type PlatformBatch,
  type PlatformJobDetail,
  type PlatformSession,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { BossHttpSession } from './boss.js';
import type { BossPageState } from './boss-page-state.js';
import { BossPageLifecycle } from './boss-page-lifecycle.js';

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
  readonly epoch: number;
  status?: number;
}

/** 一页尚未消费的真实响应；不通过刷新补齐历史记录。 */
interface ObservedPage {
  readonly url: URL;
  readonly response: Response;
  readonly observedAt: number;
}

/** BOSS 默认浏览器传输：正常页面动作产生 JSON，复用原协议和入库门槛。 */
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
  #lastJobId: string | undefined;
  readonly #lifecycle: BossPageLifecycle;
  #detail:
    | { securityId: string; resolve(response: Response): void; reject(error: unknown): void }
    | undefined;

  public constructor(
    private readonly input: {
      readonly sessionId: string;
      /** 仅 Worker 自建页允许首批消费前的同源初始化导航。 */
      readonly initialNavigationUrl?: string;
      readonly inspectPage?: (signal: AbortSignal) => Promise<BossPageState>;
      readonly lifecycle?: BossPageLifecycle;
      readonly call: (
        method: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<unknown>;
      /** 只能点击通过本批校验的稳定职位链接，不能调用私有页面方法。 */
      readonly clickJob: (jobId: string, signal: AbortSignal) => Promise<void>;
      readonly loadNext?: (lastJobId: string, signal: AbortSignal) => Promise<void>;
      /** 独立后台窗口不抢占前台；显式借用调试页可沿用激活策略。 */
      readonly activateForNext?: boolean;
    },
  ) {
    this.#lifecycle =
      input.lifecycle ??
      new BossPageLifecycle({
        allowInitialNavigation: !!input.initialNavigationUrl,
        inspectPage: input.inspectPage,
      });
  }

  /** 释放观察正文及在途等待，但不拥有或关闭用户授权的 Socket。 */
  public disconnect(): void {
    this.#lifecycle.disconnect();
    this.#fail(new PlatformError('session_unavailable', null, 'browser_disconnected'));
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
        const frame = z
          .object({ parentId: z.string().optional(), url: z.string().optional() })
          .parse(params.frame);
        if (!frame.parentId) {
          // 1.a、首批之前只清空旧文档观察；首批开始后导航必须使候选失效。
          const epoch = this.#lifecycle.epoch;
          this.#lifecycle.navigate(frame.url);
          this.#lifecycle.assertCurrent();
          if (epoch !== this.#lifecycle.epoch) {
            this.#requests.clear();
            this.#observedDetails.clear();
            this.#page = undefined;
            this.#query = undefined;
          }
        }
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
        if (request.request.method !== 'GET' || request.redirectResponse)
          throw new PlatformError('parse_changed');
        if (url.pathname === listPath) {
          if (
            this.#remaining.size > 0 ||
            this.#page ||
            [...this.#requests.values()].some((value) => value.url.pathname === listPath)
          )
            throw new PlatformError('session_unavailable', null, 'duplicate_list');
          const query = new URLSearchParams(url.searchParams);
          query.delete('page');
          query.delete('_');
          query.sort();
          if (this.#query !== undefined && this.#query !== query.toString())
            throw new PlatformError('session_unavailable', null, 'query_changed');
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
        this.#requests.set(request.requestId, { url, epoch: this.#lifecycle.epoch });
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
        throw new PlatformError('network_error', null, 'browser_request_failed');
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
      let rawResult: unknown;
      try {
        rawResult = await this.input.call(
          'Network.getResponseBody',
          { requestId },
          AbortSignal.any([this.#abort.signal, AbortSignal.timeout(10_000)]),
        );
      } catch {
        throw new PlatformError('session_unavailable', null, 'response_body_unavailable');
      }
      // 1.a、旧文档的异步正文不可回写，也不可用其错误冻结新文档。
      if (request.epoch !== this.#lifecycle.epoch) return;
      const result = z
        .object({ body: z.string().max(maxBytes * 2), base64Encoded: z.boolean() })
        .parse(rawResult);
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
          envelope.code === 37 ? 'security_check' : 'envelope',
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
      if (request.epoch === this.#lifecycle.epoch)
        this.#fail(error instanceof PlatformError ? error : new PlatformError('parse_changed'));
    } finally {
      if (this.#requests.get(requestId) === request) this.#requests.delete(requestId);
    }
  }

  /** 首次必须消费连接后观察到的第一页；后续页不得跳页或更换查询。 */
  public async readNext(signal: AbortSignal): Promise<PlatformBatch> {
    return this.#exclusive(
      signal,
      async (operationSignal) => {
        operationSignal.throwIfAborted();
        if (this.#remaining.size > 0) throw new PlatformError('session_unavailable');
        if (!this.#hasMore) return { candidates: [], hasMore: false };
        // 1、后续用户动作仅触发一次正常加载；已有预取响应则直接消费，不重复翻页。
        if (this.#client && !this.#page && this.input.loadNext) {
          // 1.a、显式获取时激活专用页，避免官网在后台延迟滚动后的加载；不刷新。
          if (this.input.activateForNext !== false)
            await this.input.call('Page.bringToFront', {}, operationSignal);
          await this.#lifecycle.waitReady(operationSignal, { timeoutMs: 20_000 });
          // 1.b、激活期间可能已产生响应或在途请求，不能再次触发第三页。
          if (!this.#hasObservedList()) {
            if (!this.#lastJobId)
              throw new PlatformError('session_unavailable', null, 'next_page_control_unavailable');
            await this.input.loadNext(this.#lastJobId, operationSignal);
          }
        }
        // 2、正常页面与真实列表共同就绪才消费，不刷新或构造接口请求。
        const epoch = await this.#lifecycle.waitReady(operationSignal, {
          timeoutMs: !this.#client ? 60_000 : 20_000,
          available: () => this.#page !== undefined,
        });
        this.#lifecycle.assertCurrent(epoch);
        this.#lifecycle.lock();
        if (!this.#page)
          throw new PlatformError('session_unavailable', null, 'list_response_timeout');
        if (!this.#client) {
          this.#client = new BossHttpSession({
            cookies: [],
            observedListUrl: this.#page.url.href,
            browserResponse: (url, requestSignal, jobId) =>
              this.#response(url, requestSignal, jobId),
          });
        }
        // 2、原解析器检查重复、公司身份及分页矛盾；记录可点击的当前批次。
        const batch = await this.#client.readNext(operationSignal);
        this.#hasMore = batch.hasMore;
        this.#lastJobId = batch.candidates.at(-1)?.externalJobId;
        this.#remaining.clear();
        for (const row of batch.candidates) this.#remaining.add(row.externalJobId);
        return batch;
      },
      !this.#client ? 65_000 : 25_000,
    );
  }

  /** 复核已到达或正在接收的列表，避免激活后重复滚动。 */
  #hasObservedList(): boolean {
    // 1、异步 CDP 回调会在 await 期间更新状态，须重新读取而非沿用先前判断。
    return (
      this.#page !== undefined ||
      [...this.#requests.values()].some((request) => request.url.pathname === listPath)
    );
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
    // 1、串行处理已完成后直接点击下一条，不额外施加实验用固定间隔。
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
  async #exclusive<T>(
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const initialFailure = this.#currentFailure();
    if (initialFailure) throw initialFailure;
    if (this.#busy) throw new PlatformError('session_unavailable');
    this.#busy = true;
    const operationSignal = AbortSignal.any([
      signal,
      this.#abort.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
    try {
      return await work(operationSignal);
    } catch (error) {
      const failure =
        this.#currentFailure() ??
        (signal.aborted
          ? new PlatformError('session_unavailable')
          : error instanceof PlatformError
            ? error
            : operationSignal.aborted
              ? new PlatformError('session_unavailable', null, 'browser_operation_timeout')
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
