import { z } from 'zod';
import { PlatformError } from '@jobhunter/recruitment/platform-contracts';
import { job51ContentTypeError, type Job51HttpSession } from './job51.js';
import { associateBrowserFailure } from '../../application/response-diagnostics.js';

/** 所选目标的有界事件桥，只观察只读职位端点，不获取响应正文。 */
export class Job51RequestObserver {
  #failureRequestId: string | undefined;
  readonly #requests = new Map<
    string,
    {
      at: number;
      url: string;
      headers: Record<string, string>;
      extra?: Record<string, string>;
      success?: boolean;
      failure?: { readonly error: PlatformError; readonly status: number };
    }
  >();
  public constructor(
    private readonly sessionId: string,
    private readonly session: Job51HttpSession,
    private readonly readBody?: (requestId: string) => Promise<string | undefined>,
  ) {}

  /** 合并 CDP 请求与额外头事件；同一请求的 Cookie 不混入其他请求。 */
  public accept(input: unknown): void {
    // 1、其他标签页和无关请求一律忽略。
    if (!this.session.active) {
      this.clear();
      return;
    }
    const event = z
      .object({
        sessionId: z.string().optional(),
        method: z.string(),
        params: z.record(z.string(), z.unknown()),
      })
      .safeParse(input);
    if (!event.success) return;
    const { method, params } = event.data;
    if (method === 'Target.detachedFromTarget' && params.sessionId === this.sessionId) {
      this.session.fail(new PlatformError('session_unavailable'));
      this.clear();
      return;
    }
    if (event.data.sessionId !== this.sessionId) return;
    for (const [id, r] of this.#requests)
      if (Date.now() - r.at > 120_000) this.#requests.delete(id);
    const id = typeof params.requestId === 'string' ? params.requestId : undefined;
    if (!id) return;
    if (this.#failureRequestId !== undefined && this.#failureRequestId !== id) return;
    if (method === 'Network.requestWillBeSent') {
      const parsed = z
        .object({ url: z.string(), method: z.string(), headers: z.record(z.string(), z.string()) })
        .safeParse(params.request);
      if (!parsed.success) return;
      const r = parsed.data;
      if (!r.url.startsWith('https://we.51job.com/api/job/search-pc?') || r.method !== 'GET')
        return;
      const oldest = this.#requests.keys().next().value;
      if (this.#requests.size >= 5 && oldest !== undefined) this.#requests.delete(oldest);
      this.#requests.set(id, { at: Date.now(), url: r.url, headers: r.headers });
    }
    const request = this.#requests.get(id);
    if (!request) return;
    // 2、必须收到本次成功响应和完整实际请求头后才可供 HTTP 使用。
    if (method === 'Network.requestWillBeSentExtraInfo') {
      const headers = z.record(z.string(), z.string()).safeParse(params.headers);
      if (headers.success) request.extra = headers.data;
    }
    if (method === 'Network.responseReceived') {
      const response = z
        .object({ status: z.number(), mimeType: z.string().optional() })
        .safeParse(params.response);
      if (!response.success) return;
      const { status, mimeType } = response.data;
      const error =
        status !== 200
          ? new PlatformError(
              status === 429
                ? 'rate_limited'
                : status === 403
                  ? 'access_blocked'
                  : 'upstream_error',
              status,
            )
          : /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(mimeType ?? '')
            ? new PlatformError('parse_changed', null, 'content_type')
            : undefined;
      if (error) {
        // 只从已经发生的本页请求读取失败正文，失败模板不能送入 HTTP。
        if (this.readBody) {
          this.#failureRequestId = id;
          request.failure = { error, status };
        } else {
          this.session.fail(error);
          this.clear();
        }
        return;
      }
      request.success = true;
    }
    if (method === 'Network.loadingFinished' && request.failure) {
      const { error, status } = request.failure;
      this.#requests.delete(id);
      void this.#finishFailure(id, error, status);
      return;
    }
    if (method === 'Network.loadingFailed') {
      this.session.fail(request.failure?.error ?? new PlatformError('network_error'));
      this.clear();
      return;
    }
    if (request.success && request.extra) {
      this.session.offer({ url: request.url, headers: { ...request.headers, ...request.extra } });
      this.#requests.delete(id);
    }
  }

  /** 正文读取失败时仍保留官网原来的失败分类。 */
  async #finishFailure(id: string, error: PlatformError, status: number): Promise<void> {
    try {
      const body = await this.readBody?.(id);
      if (body !== undefined) {
        if (error.reason === 'content_type') error = job51ContentTypeError(body);
        associateBrowserFailure(error, status, body);
      }
    } catch {
      // CDP 已释放页面或正文不可用。
    }
    this.session.fail(error);
    this.clear();
  }

  /** 结束监听时清空全部在途认证字段。 */
  public clear(): void {
    this.#failureRequestId = undefined;
    this.#requests.clear();
  }
}
