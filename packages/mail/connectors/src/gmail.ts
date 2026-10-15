import {
  MailConnectorError,
  externalMailMessageRefSchema,
  externalMailMessageSchema,
  type MailChangePage,
  type MailboxConnector,
  type MailboxReadContext,
  type MailChangeRequest,
  type MailFolder,
  type ExternalMailMessage,
  type ExternalMailMessageRef,
  type MailHealthResult,
} from '@jobhunter/mail-core';
import { credentialValue, requestJson, safeMessage, safeRef } from './shared.js';

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}
interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: GmailApiMessage }>;
    messages?: GmailApiMessage[];
    messagesDeleted?: Array<{ message: GmailApiMessage }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}
interface GmailApiMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPayload;
  snippet?: string;
}
interface GmailPayload {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
}

/** Gmail API 的只读连接器；游标是 Gmail historyId，网络请求始终在事务外执行。 */
export class GmailConnector implements MailboxConnector {
  public readonly metadata = {
    providerKey: 'gmail' as const,
    version: 'gmail-api-v1',
    authKind: 'oauth' as const,
    incrementalMode: 'history' as const,
    folderMode: 'labels' as const,
    supportsStableMessageId: true,
    supportStatus: 'experimental' as const,
  };
  readonly #credentials: (
    ref: string,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly #baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';

  public constructor(
    credentials: (ref: string, signal?: AbortSignal) => Promise<Readonly<Record<string, string>>>,
  ) {
    this.#credentials = credentials;
  }

  public async listFolders(context: MailboxReadContext): Promise<readonly MailFolder[]> {
    const token = await this.#token(context);
    const result = await requestJson<{
      labels?: Array<{ id: string; name: string; type?: string }>;
    }>(`${this.#baseUrl}/labels`, this.#init(token, context));
    return (result.labels ?? []).map((label) => ({
      id: label.id,
      displayName: label.name,
      kind: label.id === 'INBOX' ? 'inbox' : label.type === 'SYSTEM' ? 'system' : 'user',
      selectable: true,
    }));
  }

  public async *discoverChanges(
    context: MailboxReadContext,
    request: MailChangeRequest,
  ): AsyncIterable<MailChangePage> {
    const token = await this.#token(context);
    const pageSize = Math.min(request.pageSize ?? 100, 500);
    const cursor = asGmailCursor(request.cursor);
    if (cursor?.historyId) {
      yield* this.#historyPages(
        token,
        context,
        request,
        cursor.historyId,
        pageSize,
        cursor.pageToken,
      );
      return;
    }
    const initialProfile = await requestJson<{ historyId: string }>(
      `${this.#baseUrl}/profile`,
      this.#init(token, context),
    );
    const after = Math.floor(
      (Date.now() - Math.min(request.lookbackDays, 365) * 86_400_000) / 1000,
    );
    let pageToken: string | undefined;
    const refs: ExternalMailMessageRef[] = [];
    do {
      const query = [
        `after:${String(after)}`,
        ...request.folders.map((folder) => `label:${folder.replace(/^label:/, '')}`),
      ].join(' ');
      const url = new URL(`${this.#baseUrl}/messages`);
      url.searchParams.set('maxResults', String(pageSize));
      url.searchParams.set('q', query);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const list = await requestJson<GmailMessageListResponse>(url, this.#init(token, context));
      for (const item of list.messages ?? []) refs.push(await this.#ref(token, context, item.id));
      if (refs.length >= pageSize) {
        const page = refs.splice(0, pageSize);
        yield {
          messages: page,
          nextCursor: { historyId: initialProfile.historyId },
          hasMore: true,
        };
      }
      pageToken = list.nextPageToken;
    } while (pageToken);
    while (refs.length > 0) {
      yield {
        messages: refs.splice(0, pageSize),
        nextCursor: { historyId: initialProfile.historyId },
        hasMore: true,
      };
    }
    yield* this.#historyPages(token, context, request, initialProfile.historyId, pageSize);
  }

  public async fetchMessage(
    context: MailboxReadContext,
    message: ExternalMailMessageRef,
  ): Promise<ExternalMailMessage> {
    const token = await this.#token(context);
    const result = await requestJson<GmailApiMessage>(
      `${this.#baseUrl}/messages/${encodeURIComponent(message.externalMessageKey)}?format=full`,
      this.#init(token, context),
    );
    return externalMailMessageSchema.parse(
      safeMessage({
        ...message,
        subject: header(result.payload, 'subject'),
        fromName: header(result.payload, 'from'),
        fromAddress: parseAddress(header(result.payload, 'from')),
        textBody: decodeBody(result.payload, 'text/plain'),
        htmlBody: nullableBody(result.payload, 'text/html'),
        calendarBody: nullableBody(result.payload, 'text/calendar'),
        headers: Object.fromEntries(
          (result.payload?.headers ?? []).map((item) => [item.name.toLowerCase(), item.value]),
        ),
      }),
    );
  }

  public async healthCheck(context: MailboxReadContext): Promise<MailHealthResult> {
    await this.listFolders(context);
    return { status: 'healthy', checkedAt: Date.now() };
  }

  async *#historyPages(
    token: string,
    context: MailboxReadContext,
    request: MailChangeRequest,
    historyId: string,
    pageSize: number,
    initialPageToken?: string,
  ): AsyncIterable<MailChangePage> {
    let pageToken: string | undefined = initialPageToken;
    do {
      const url = new URL(`${this.#baseUrl}/history`);
      url.searchParams.set('startHistoryId', historyId);
      url.searchParams.set('historyTypes', 'messageAdded');
      url.searchParams.set('maxResults', String(pageSize));
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      let result: GmailHistoryResponse;
      try {
        result = await requestJson<GmailHistoryResponse>(url, this.#init(token, context));
      } catch (error) {
        if (error instanceof MailConnectorError && error.category === 'parse_changed') {
          throw new MailConnectorError(
            'cursor_invalid',
            'Gmail history cursor is no longer valid.',
            { cause: error },
          );
        }
        throw error;
      }
      const messages = (result.history ?? [])
        .flatMap((entry) => [
          ...(entry.messagesAdded ?? []).map((item) => item.message),
          ...(entry.messages ?? []),
        ])
        .filter(
          (item) =>
            request.folders.length === 0 ||
            item.labelIds?.some((label) =>
              request.folders.some((folder) => folder.replace(/^label:/, '') === label),
            ),
        );
      const refs = await Promise.all(
        [...new Map(messages.map((item) => [item.id, item])).values()].map((item) =>
          this.#ref(token, context, item.id),
        ),
      );
      pageToken = result.nextPageToken;
      yield {
        messages: refs,
        nextCursor: pageToken
          ? { historyId, pageToken }
          : { historyId: result.historyId ?? historyId },
        hasMore: Boolean(pageToken),
      };
    } while (pageToken);
  }

  async #ref(
    token: string,
    context: MailboxReadContext,
    id: string,
  ): Promise<ExternalMailMessageRef> {
    const result = await requestJson<GmailApiMessage>(
      `${this.#baseUrl}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Date`,
      this.#init(token, context),
    );
    const receivedAt = Number(result.internalDate ?? Date.now());
    return safeRef(
      externalMailMessageRefSchema.parse({
        mailboxKey: context.mailboxKey,
        providerKey: 'gmail',
        externalMessageKey: result.id,
        folderId:
          result.labelIds?.find((label) => label === 'INBOX') ?? result.labelIds?.[0] ?? 'INBOX',
        threadKey: result.threadId ?? null,
        receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
        contentVersion: result.internalDate ?? result.id,
        sourceUrl: null,
        changeKind: 'added',
      }),
    );
  }

  async #token(context: MailboxReadContext): Promise<string> {
    const values = await credentialValue(context, this.#credentials);
    if (!values.accessToken)
      throw new MailConnectorError('authentication_required', 'Gmail access token is missing.');
    return values.accessToken;
  }
  #init(token: string, context: MailboxReadContext): RequestInit & { timeoutMs: number } {
    return {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      ...(context.signal ? { signal: context.signal } : {}),
      timeoutMs: context.timeoutMs ?? 30_000,
    };
  }
}

function asGmailCursor(value: unknown): { historyId?: string; pageToken?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const historyId = (value as { historyId?: unknown }).historyId;
  const pageToken = (value as { pageToken?: unknown }).pageToken;
  return typeof historyId === 'string'
    ? {
        historyId,
        ...(typeof pageToken === 'string' ? { pageToken } : {}),
      }
    : null;
}
function header(payload: GmailPayload | undefined, name: string): string {
  return (
    payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}
function parseAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1] ?? value;
}
function decodeBody(payload: GmailPayload | undefined, mimeType: string): string {
  if (!payload) return '';
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
  }
  for (const part of payload.parts ?? []) {
    const value = decodeBody(part, mimeType);
    if (value) return value;
  }
  return '';
}
function nullableBody(payload: GmailPayload | undefined, mimeType: string): string | null {
  const value = decodeBody(payload, mimeType);
  return value || null;
}
