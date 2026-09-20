import { z } from 'zod';
import { PlatformError } from '@jobhunter/platform-core';
import type { Job51HttpSession } from './job51.js';

/** 所选目标的有界事件桥，只观察只读职位端点，不获取响应正文。 */
export class Job51RequestObserver {
  readonly #requests = new Map<
    string,
    {
      at: number;
      url: string;
      headers: Record<string, string>;
      extra?: Record<string, string>;
      success?: boolean;
    }
  >();
  public constructor(
    private readonly sessionId: string,
    private readonly session: Job51HttpSession,
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
      const response = z.object({ status: z.number() }).safeParse(params.response);
      if (!response.success) return;
      if (response.data.status !== 200) {
        this.session.fail(
          new PlatformError(
            response.data.status === 429
              ? 'rate_limited'
              : response.data.status === 403
                ? 'access_blocked'
                : 'upstream_error',
          ),
        );
        this.clear();
        return;
      }
      request.success = true;
    }
    if (method === 'Network.loadingFailed') {
      this.session.fail(new PlatformError('network_error'));
      this.clear();
      return;
    }
    if (request.success && request.extra) {
      this.session.offer({ url: request.url, headers: { ...request.headers, ...request.extra } });
      this.#requests.delete(id);
    }
  }

  /** 结束监听时清空全部在途认证字段。 */
  public clear(): void {
    this.#requests.clear();
  }
}
