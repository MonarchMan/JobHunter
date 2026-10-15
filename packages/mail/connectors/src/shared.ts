import {
  MailConnectorError,
  type ExternalMailMessage,
  type ExternalMailMessageRef,
  type MailboxReadContext,
  parseSafeMailSourceUrl,
} from '@jobhunter/mail-core';

/** 统一 fetch 超时、取消和错误映射；不把远端响应正文暴露给调用方。 */
export async function requestJson<T>(
  input: string | URL,
  init: RequestInit & { readonly timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 30_000);
  const signal = init.signal;
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (response.status === 401)
      throw new MailConnectorError('authentication_required', 'Mailbox authorization is required.');
    if (response.status === 403)
      throw new MailConnectorError('permission_denied', 'Mailbox permission was denied.');
    if (response.status === 404)
      throw new MailConnectorError('message_not_found', 'Mailbox resource was not found.');
    if (response.status === 429)
      throw new MailConnectorError('rate_limited', 'Mailbox provider rate limit reached.');
    if (response.status >= 500)
      throw new MailConnectorError('upstream_5xx', 'Mailbox provider is temporarily unavailable.');
    if (!response.ok)
      throw new MailConnectorError('parse_changed', 'Mailbox provider response was not accepted.');
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MailConnectorError) throw error;
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new MailConnectorError(
        signal?.aborted ? 'cancelled' : 'network_temporary',
        'Mailbox request was cancelled or timed out.',
        { cause: error },
      );
    }
    throw new MailConnectorError('network_temporary', 'Mailbox request failed.', { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 从凭据库中读取 OAuth 或 IMAP 所需字段并校验最小形状。 */
export async function credentialValue(
  context: MailboxReadContext,
  resolver: (ref: string, signal?: AbortSignal) => Promise<Readonly<Record<string, string>>>,
): Promise<Readonly<Record<string, string>>> {
  const values = await resolver(context.credentialRef, context.signal);
  if (!values.accessToken && !values.password) {
    throw new MailConnectorError(
      'authentication_required',
      'Credential reference has no usable secret.',
    );
  }
  return values;
}

/** 规范化来源引用，连接器不会保存带认证参数的 URL。 */
export function safeRef(ref: ExternalMailMessageRef): ExternalMailMessageRef {
  return { ...ref, sourceUrl: parseSafeMailSourceUrl(ref.sourceUrl) };
}

/** 规范化按需邮件，避免连接器返回超长或不受支持的内容。 */
export function safeMessage(message: ExternalMailMessage): ExternalMailMessage {
  return {
    ...message,
    sourceUrl: parseSafeMailSourceUrl(message.sourceUrl),
    textBody: message.textBody.slice(0, 200_000),
    htmlBody: message.htmlBody?.slice(0, 400_000) ?? null,
    calendarBody: message.calendarBody?.slice(0, 100_000) ?? null,
  };
}
