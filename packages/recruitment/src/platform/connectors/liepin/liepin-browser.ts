import { setTimeout as delay } from 'node:timers/promises';
import { PlatformError } from '@jobhunter/recruitment/platform-contracts';
import { z } from 'zod';
import { associateBrowserFailure } from '../../application/response-diagnostics.js';
import type { PlatformRequestPacer } from '../browser/request-pacing.js';
import { liepinVerificationReason } from './liepin-verification.js';

const bodyLimit = 2 * 1024 * 1024;
const eventSchema = z.object({
  sessionId: z.string(),
  method: z.string(),
  params: z.object({
    requestId: z.string().optional(),
    loaderId: z.string().optional(),
    type: z.string().optional(),
    frame: z.object({ url: z.string(), parentId: z.string().optional() }).optional(),
    request: z
      .object({
        url: z.string(),
        method: z.string(),
        postData: z.string().max(20_000).optional(),
      })
      .optional(),
    response: z.object({ status: z.number().int(), mimeType: z.string() }).optional(),
    redirectResponse: z.object({ status: z.number().int() }).optional(),
  }),
});

/** 官网导航产生的正文及真实列表请求模板，仅供会话内部消费。 */
interface PageResponse {
  readonly response: Response;
  readonly template?: string | undefined;
}

/** 单次官网导航使用独立工作集，旧请求事件无法覆盖当前页。 */
interface Navigation {
  readonly url: string;
  readonly list?: { endpoint: string; keyword: string; page: number } | undefined;
  readonly signal: AbortSignal;
  readonly resolve: (result: PageResponse) => void;
  readonly reject: (error: PlatformError) => void;
  documentId?: string;
  loaderId?: string;
  requestId?: string;
  template?: string;
  status?: number;
  mimeType?: string;
  documentMime?: string;
}

/** 通过现有 CDP 窗口导航，仅读取该页面真实产生的列表和文档响应。 */
export class LiepinBrowserNavigation {
  readonly #abort = new AbortController();
  #pending: Navigation | undefined;

  public constructor(
    private readonly input: {
      sessionId: string;
      call: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
      pacer: PlatformRequestPacer;
    },
  ) {}

  /** 连接中断时立即结束页面等待，不再处理旧页面事件。 */
  public disconnect(): void {
    this.#abort.abort();
    this.#pending?.reject(new PlatformError('session_unavailable'));
    this.#pending = undefined;
  }

  /** 先订阅本次页面响应，再按配置发送一次导航；超时不重发。 */
  public async read(
    url: string,
    signal: AbortSignal,
    list?: Navigation['list'],
  ): Promise<PageResponse> {
    if (this.#pending) throw new PlatformError('session_unavailable');
    const navigationSignal = AbortSignal.any([signal, this.#abort.signal]);
    // 1、详情和续页在本次导航前等待，首屏查询直接使用固定间隔。
    if (!list || list.page > 0) {
      const [minimum, maximum] = list ? [20_000, 35_000] : [10_000, 18_000];
      const waitMs = minimum + Math.floor(Math.random() * (maximum - minimum + 1));
      await delay(waitMs, undefined, { signal: navigationSignal });
    }
    await this.input.pacer.before(navigationSignal);
    // 2、正文读取预算独立于主动等待。
    const operation = AbortSignal.any([navigationSignal, AbortSignal.timeout(18_000)]);
    let onAbort: () => void = () => undefined;
    try {
      operation.throwIfAborted();
      const response = new Promise<PageResponse>((resolve, reject) => {
        this.#pending = { url, list, signal: operation, resolve, reject };
        onAbort = () => {
          reject(new PlatformError('session_unavailable', null, 'browser_response_timeout'));
        };
        operation.addEventListener('abort', onAbort, { once: true });
      });
      const navigate =
        list && list.page > 0
          ? this.#turnPage(list, operation)
          : this.input.call('Page.navigate', { url }, operation).then((raw) => {
              const result = z.object({ errorText: z.string().optional() }).parse(raw);
              if (result.errorText)
                throw new PlatformError('network_error', null, 'browser_request_failed');
            });
      const [result] = await Promise.all([response, navigate]);
      return result;
    } finally {
      operation.removeEventListener('abort', onAbort);
      this.#pending = undefined;
    }
  }

  /** 用官网分页控件续页，并校验当前页及关键词，避免重复导航到首页。 */
  async #turnPage(list: NonNullable<Navigation['list']>, signal: AbortSignal): Promise<void> {
    const expression = `(() => {
      const url = new URL(location.href);
      if (url.origin !== 'https://www.liepin.com' || url.pathname !== '/zhaopin/' ||
          url.searchParams.get('key') !== ${JSON.stringify(list.keyword)}) return false;
      const pager = document.querySelector('.list-pagination-box .ant-pagination');
      const current = pager?.querySelector('.ant-pagination-item-active');
      const next = pager?.querySelector('.ant-pagination-next button:not([disabled])');
      if (current?.getAttribute('title') !== ${JSON.stringify(String(list.page))} || !next) return false;
      next.click();
      return true;
    })()`;
    const result = z
      .object({ result: z.object({ value: z.boolean() }) })
      .safeParse(
        await this.input.call('Runtime.evaluate', { expression, returnByValue: true }, signal),
      );
    if (!result.success || !result.data.result.value)
      throw new PlatformError('session_unavailable', null, 'liepin_pagination_control');
  }

  /** 区分主文档、目标列表和无关资源，遇到官网验证及登录立即停止。 */
  public accept(raw: unknown): void {
    const pending = this.#pending;
    if (!pending) return;
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sessionId !== this.input.sessionId) return;
    const { method, params } = parsed.data;
    const { frame, request, requestId, type, response, redirectResponse } = params;
    if (method === 'Page.frameNavigated' && frame && !frame.parentId) {
      const url = URL.parse(frame.url);
      const reason = url && pageGate(url);
      if (reason) pending.reject(new PlatformError('access_blocked', null, reason));
    }
    if (!requestId) return;
    if (method === 'Network.requestWillBeSent' && request) {
      // 1、主文档以本次明确导航的初始 URL 关联，随后按同一 ID 识别跳转。
      if (type === 'Document' && request.url === pending.url && !pending.documentId) {
        pending.documentId = requestId;
        if (params.loaderId) pending.loaderId = params.loaderId;
      }
      if (requestId === pending.documentId && redirectResponse) {
        const target = URL.parse(request.url);
        const reason = target ? pageGate(target) : undefined;
        if (reason || target?.href !== pending.url) {
          pending.reject(
            new PlatformError(
              'access_blocked',
              redirectResponse.status,
              reason ??
                (target?.protocol === 'https:' && target.hostname.endsWith('.liepin.com')
                  ? 'redirect_internal_other'
                  : 'redirect_external'),
            ),
          );
          return;
        }
      }
      // 2、列表必须由网页发出且关键词和零基页码均匹配本次导航。
      if (pending.list) {
        if (
          pending.requestId ||
          (pending.loaderId && params.loaderId !== pending.loaderId) ||
          request.method !== 'POST' ||
          request.url !== pending.list.endpoint ||
          !request.postData
        )
          return;
        const conditions = searchConditions(request.postData);
        if (
          conditions?.key !== pending.list.keyword ||
          conditions.currentPage !== pending.list.page
        )
          return;
        pending.template = request.postData;
        pending.requestId = requestId;
      } else if (requestId === pending.documentId) pending.requestId = requestId;
    }
    if (requestId !== pending.requestId && requestId !== pending.documentId) return;
    if (method === 'Network.responseReceived' && response) {
      if (requestId === pending.documentId && pending.list && response.status === 200) {
        pending.documentMime = response.mimeType;
        return;
      }
      pending.requestId = requestId;
      pending.status = response.status;
      pending.mimeType = response.mimeType;
    }
    if (method === 'Network.loadingFinished' && requestId === pending.requestId)
      void this.#finish(pending, requestId);
    else if (method === 'Network.loadingFinished' && pending.documentMime && !pending.requestId)
      void this.#finish(pending, requestId, pending.documentMime);
    if (method === 'Network.loadingFailed') {
      const failure =
        requestId === pending.requestId && pending.status !== undefined
          ? classifyLiepinBrowserResponse(
              pending.status,
              pending.mimeType ?? '',
              '',
              !!pending.list,
            )
          : undefined;
      pending.reject(failure ?? new PlatformError('network_error', null, 'browser_request_failed'));
    }
  }

  /** 读取完整有界正文，将协议失败与浏览器正文读取失败区分。 */
  async #finish(pending: Navigation, requestId: string, documentMime?: string): Promise<void> {
    const status = documentMime ? 200 : pending.status;
    const mime = documentMime ?? pending.mimeType ?? '';
    const list = !documentMime && !!pending.list;
    if (status === undefined || status < 200 || status > 599) {
      pending.reject(new PlatformError('parse_changed', null, 'browser_response_unavailable'));
      return;
    }
    try {
      const result = z
        .object({
          body: z.string().max(bodyLimit * 2),
          base64Encoded: z.boolean(),
        })
        .parse(await this.input.call('Network.getResponseBody', { requestId }, pending.signal));
      const bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
      if (bytes.length > bodyLimit) throw new Error('body limit');
      const body = bytes.toString('utf8');
      const error = classifyLiepinBrowserResponse(status, mime, body, list);
      if (error) {
        associateBrowserFailure(error, status, body);
        pending.reject(error);
      } else if (!documentMime) {
        pending.resolve({
          response: new Response(new Uint8Array(bytes), {
            status,
            headers: { 'content-type': mime },
          }),
          template: pending.template,
        });
      }
    } catch {
      // 搜索页外壳不可读时仍等待实际列表；不能用该外壳替代列表。
      if (!documentMime)
        pending.reject(
          classifyLiepinBrowserResponse(status, mime, '', list) ??
            new PlatformError('parse_changed', null, 'browser_response_unavailable'),
        );
    }
  }
}

/** 只在官方猎聘域识别登录和验证路径，不将原始地址写入错误。 */
function pageGate(url: URL): string | undefined {
  const verification = liepinVerificationReason(url);
  if (verification) return verification;
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.liepin.com')) return undefined;
  if (
    url.hostname === 'passport.liepin.com' ||
    /(?:^|\/)(?:login|signin)(?:\/|$)/i.test(url.pathname)
  )
    return 'redirect_login';
  return undefined;
}

/** 借鉴前程无忧的分层诊断，只有明确验证或登录标记才归为访问限制。 */
export function classifyLiepinBrowserResponse(
  status: number,
  mime: string,
  body: string,
  list: boolean,
): PlatformError | undefined {
  if (status !== 200) {
    return new PlatformError(
      status === 429
        ? 'rate_limited'
        : status === 401 || status === 403
          ? 'access_blocked'
          : 'upstream_error',
      status,
    );
  }
  if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(mime)) {
    const title = /<title\b[^>]*>([^<]{0,150})<\/title\s*>/i.exec(body)?.[1] ?? '';
    if (/安全中心|安全验证|短信验证|人机验证/.test(title))
      return new PlatformError('access_blocked', status, 'verification_required');
    if (/登录猎聘|猎聘登录|用户登录|账号登录/.test(title))
      return new PlatformError('access_blocked', status, 'redirect_login');
  }
  if (list ? !/^application\/json\b/i.test(mime) : !/^text\/html\b/i.test(mime))
    return new PlatformError('parse_changed', status, 'content_type');
  return undefined;
}

/** 从自然发出的请求中只提取匹配本页所需的非敏感字段。 */
function searchConditions(body: string): { key: string; currentPage: number } | undefined {
  try {
    const parsed = z
      .object({
        data: z.object({
          mainSearchPcConditionForm: z.object({ key: z.string(), currentPage: z.number().int() }),
        }),
      })
      .safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.data.mainSearchPcConditionForm : undefined;
  } catch {
    return undefined;
  }
}
