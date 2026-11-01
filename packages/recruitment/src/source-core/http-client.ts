import { SourceError } from './errors.js';
import { validateOfficialUrl } from './url-policy.js';

/** 来源适配器使用的数据结构或契约。 */
export interface SourceRateLimitGate {
  beforeRequest(input: { readonly sourceKey: string; readonly signal: AbortSignal }): Promise<void>;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourceHttpRequest {
  readonly sourceKey: string;
  readonly requestId: string;
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly responseType: 'json' | 'text';
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourceHttpResponse<TBody> {
  readonly status: number;
  readonly url: string;
  readonly headers: Headers;
  readonly body: TBody;
}

/** 来源适配器使用的数据结构或契约。 */
export interface SourceHttpClient {
  request<TBody = unknown>(request: SourceHttpRequest): Promise<SourceHttpResponse<TBody>>;
}

/** 来源适配器使用的数据结构或契约。 */
export interface FetchSourceHttpClientOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly rateLimitGate?: SourceRateLimitGate;
  readonly userAgent?: string;
  readonly defaultTimeoutMs?: number;
  readonly defaultMaximumResponseBytes?: number;
  readonly maximumRedirects?: number;
}

/** 解析 Retry-After 响应头为绝对时间。 */
function retryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : date;
}

/** 将 HTTP 状态码映射为来源错误分类。 */
function classifyStatus(status: number, headers: Headers): void {
  if (status === 401 || status === 403) {
    throw new SourceError(
      'access_blocked',
      `Official source rejected access with HTTP ${String(status)}.`,
    );
  }
  if (status === 404 || status === 410) {
    throw new SourceError('not_found', `Official source returned HTTP ${String(status)}.`);
  }
  if (status === 429) {
    const retryAfterAt = retryAfter(headers);
    throw new SourceError('rate_limited', 'Official source rate limited the request.', {
      ...(retryAfterAt === undefined ? {} : { retryAfterAt }),
    });
  }
  if (status >= 500) {
    throw new SourceError('temporary', `Official source returned HTTP ${String(status)}.`);
  }
  if (status >= 400) {
    throw new SourceError(
      'parse_changed',
      `Official source returned unexpected HTTP ${String(status)}.`,
    );
  }
}

/** 流式读取响应并强制执行字节上限。 */
async function readLimited(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new SourceError('parse_changed', 'Source response exceeded the configured size limit.');
  }
  const stream = response.body;
  if (stream === null) return new Uint8Array();
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new SourceError('parse_changed', 'Source response exceeded the configured size limit.');
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** 识别验证码或访问验证页面。 */
function containsAccessChallenge(text: string): boolean {
  const sample = text.slice(0, 20_000).toLowerCase();
  return /captcha|验证码|访问验证|安全验证|verify you are human/.test(sample);
}

/** 基于 Fetch 的官方来源 HTTP 客户端。 */
export class FetchSourceHttpClient implements SourceHttpClient {
  readonly #fetch: typeof fetch;
  readonly #gate: SourceRateLimitGate | null;
  readonly #userAgent: string;
  readonly #defaultTimeoutMs: number;
  readonly #defaultMaximumResponseBytes: number;
  readonly #maximumRedirects: number;

  /** 执行来源组件对外暴露的操作。 */
  public constructor(options: FetchSourceHttpClientOptions = {}) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#gate = options.rateLimitGate ?? null;
    this.#userAgent = options.userAgent ?? 'JobHunter/0.1 (+local-personal-use)';
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
    this.#defaultMaximumResponseBytes = options.defaultMaximumResponseBytes ?? 2 * 1024 * 1024;
    this.#maximumRedirects = options.maximumRedirects ?? 3;
  }

  /** 执行受限请求、跟随官方重定向并解析正文。 */
  public async request<TBody = unknown>(
    // 1、执行限流和输入校验；2、校验官方 URL；3、处理有限重定向；4、限制响应并解析。
    request: SourceHttpRequest,
  ): Promise<SourceHttpResponse<TBody>> {
    await this.#gate?.beforeRequest({ sourceKey: request.sourceKey, signal: request.signal });
    if (request.signal.aborted) {
      throw new SourceError('temporary', 'Source request was aborted before dispatch.');
    }
    const timeoutMs = request.timeoutMs ?? this.#defaultTimeoutMs;
    const maximumBytes = request.maximumResponseBytes ?? this.#defaultMaximumResponseBytes;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new SourceError('invalid_config', 'Source request timeout is invalid.');
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new SourceError('invalid_config', 'Source response size limit is invalid.');
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    let current = validateOfficialUrl(request.url, request.allowedHosts);
    try {
      for (let redirects = 0; redirects <= this.#maximumRedirects; redirects += 1) {
        const response = await this.#fetch(current, {
          method: request.method ?? 'GET',
          ...(request.body === undefined ? {} : { body: request.body }),
          headers: {
            accept: request.responseType === 'json' ? 'application/json' : 'text/html,*/*;q=0.8',
            'user-agent': this.#userAgent,
            'x-jobhunter-request-id': request.requestId,
            ...request.headers,
          },
          redirect: 'manual',
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirects === this.#maximumRedirects) {
            throw new SourceError('parse_changed', 'Source returned an invalid redirect chain.');
          }
          current = validateOfficialUrl(
            new URL(location, current).toString(),
            request.allowedHosts,
          );
          continue;
        }
        classifyStatus(response.status, response.headers);
        const bytes = await readLimited(response, maximumBytes);
        const text = new TextDecoder().decode(bytes);
        if (containsAccessChallenge(text)) {
          throw new SourceError('access_blocked', 'Source returned an access verification page.');
        }
        let body: unknown = text;
        if (request.responseType === 'json') {
          try {
            body = JSON.parse(text) as unknown;
          } catch (error) {
            throw new SourceError('parse_changed', 'Source returned malformed JSON.', {
              cause: error,
            });
          }
        }
        return {
          status: response.status,
          url: response.url || current.toString(),
          headers: response.headers,
          body: body as TBody,
        };
      }
      throw new SourceError('parse_changed', 'Source redirect limit was exceeded.');
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (signal.aborted) {
        throw new SourceError('temporary', 'Source request was aborted or timed out.', {
          cause: error,
        });
      }
      throw new SourceError('temporary', 'Source request failed.', { cause: error });
    }
  }
}
