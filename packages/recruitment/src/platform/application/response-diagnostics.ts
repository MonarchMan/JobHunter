import { AsyncLocalStorage } from 'node:async_hooks';

/** 仅记录已接收的正文和状态，不接受请求或响应头。 */
export interface PlatformResponseDiagnostic {
  readonly status: number;
  readonly body: string;
}

const scope = new AsyncLocalStorage<{ response?: PlatformResponseDiagnostic }>();
const browserFailures = new WeakMap<Error, PlatformResponseDiagnostic>();
const bodyLimit = 2 * 1024 * 1024;

/** 每次任务只保留最近一个完整响应；写日志失败时保留任务原错误。 */
export function withPlatformResponseDiagnostics<T>(
  action: () => Promise<T>,
  write: (response: PlatformResponseDiagnostic) => Promise<void>,
): Promise<T> {
  const state: { response?: PlatformResponseDiagnostic } = {};
  return scope.run(state, async () => {
    try {
      return await action();
    } catch (error) {
      const response =
        (error instanceof Error ? browserFailures.get(error) : undefined) ?? state.response;
      if (response) await write(response).catch(() => undefined);
      throw error;
    }
  });
}

/** 新 HTTP 请求或详情操作开始时丢弃旧正文，避免关联到无响应的失败。 */
export function clearPlatformResponse(): void {
  const state = scope.getStore();
  if (state) delete state.response;
}

/** 返回原解码文本，同时在当前任务作用域内保留最后一个完整正文。 */
export function platformResponseText(response: Response, chunks: readonly Uint8Array[]): string {
  const body = Buffer.concat(chunks).toString('utf8');
  const state = scope.getStore();
  if (state) state.response = { status: response.status, body };
  return body;
}

/** CDP 回调可能脱离任务作用域，使用弱引用关联已读取的失败正文。 */
export function associateBrowserFailure(error: Error, status: number, body: string): void {
  if (Buffer.byteLength(body) <= bodyLimit) browserFailures.set(error, { status, body });
}

/** 已知响应会被拒绝时尝试有界读取，不额外请求，也不覆盖原异常。 */
export async function discardPlatformResponse(
  response: Response,
  signal: AbortSignal,
): Promise<void> {
  const state = scope.getStore();
  if (!state || !response.body) {
    if (state) state.response = { status: response.status, body: '' };
    await response.body?.cancel().catch(() => undefined);
    return;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) return;
      chunks.push(value);
    }
    platformResponseText(response, chunks);
  } catch {
    // 正文不完整，原失败仍由连接器报告。
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
