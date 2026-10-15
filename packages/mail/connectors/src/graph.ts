import {
  MailConnectorError,
  externalMailMessageRefSchema,
  externalMailMessageSchema,
  type ExternalMailMessage,
  type ExternalMailMessageRef,
  type MailChangePage,
  type MailChangeRequest,
  type MailFolder,
  type MailHealthResult,
  type MailboxConnector,
  type MailboxReadContext,
} from '@jobhunter/mail-core';
import { credentialValue, requestJson, safeMessage, safeRef } from './shared.js';

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}
interface GraphMessage {
  id: string;
  immutableId?: string;
  changeKey?: string;
  receivedDateTime?: string;
  subject?: string;
  webLink?: string;
  parentFolderId?: string;
  conversationId?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
}

/** Microsoft Graph 文件夹级 delta 连接器，使用 ImmutableId 避免文件夹移动改变身份。 */
export class MicrosoftGraphConnector implements MailboxConnector {
  public readonly metadata = {
    providerKey: 'microsoft-graph' as const,
    version: 'graph-v1.0',
    authKind: 'oauth' as const,
    incrementalMode: 'delta' as const,
    folderMode: 'folders' as const,
    supportsStableMessageId: true,
    supportStatus: 'experimental' as const,
  };
  readonly #credentials: (
    ref: string,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly #baseUrl = 'https://graph.microsoft.com/v1.0/me';

  public constructor(
    credentials: (ref: string, signal?: AbortSignal) => Promise<Readonly<Record<string, string>>>,
  ) {
    this.#credentials = credentials;
  }

  public async listFolders(context: MailboxReadContext): Promise<readonly MailFolder[]> {
    const token = await this.#token(context);
    const result = await requestJson<
      GraphPage<{ id: string; displayName?: string; isHidden?: boolean }>
    >(`${this.#baseUrl}/mailFolders?$select=id,displayName,isHidden`, this.#init(token, context));
    return (result.value ?? [])
      .filter((folder) => !folder.isHidden)
      .map((folder) => ({
        id: folder.id,
        displayName: folder.displayName ?? folder.id,
        kind: folder.displayName?.toLowerCase() === 'inbox' ? 'inbox' : 'user',
        selectable: true,
      }));
  }

  public async *discoverChanges(
    context: MailboxReadContext,
    request: MailChangeRequest,
  ): AsyncIterable<MailChangePage> {
    const token = await this.#token(context);
    for (const folderId of request.folders) {
      const cursor = graphFolderCursor(request.cursor, folderId);
      let url =
        cursor?.deltaLink ??
        cursor?.nextLink ??
        `${this.#baseUrl}/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=id,changeKey,receivedDateTime,subject,conversationId,parentFolderId,webLink,from&$top=${String(Math.min(request.pageSize ?? 100, 500))}`;
      do {
        let page: GraphPage<GraphMessage>;
        try {
          page = await requestJson<GraphPage<GraphMessage>>(url, this.#init(token, context));
        } catch (error) {
          if (error instanceof MailConnectorError && error.category === 'parse_changed') {
            throw new MailConnectorError(
              'cursor_invalid',
              'Microsoft Graph delta cursor is no longer valid.',
              { cause: error },
            );
          }
          throw error;
        }
        const refs = (page.value ?? []).map((item) => this.#ref(context, item));
        const nextCursor = page['@odata.deltaLink']
          ? { folderId, deltaLink: page['@odata.deltaLink'] }
          : page['@odata.nextLink']
            ? { folderId, nextLink: page['@odata.nextLink'] }
            : null;
        yield {
          messages: refs,
          nextCursor,
          hasMore: Boolean(page['@odata.nextLink']),
        };
        url = page['@odata.nextLink'] ?? '';
      } while (url);
    }
  }

  public async fetchMessage(
    context: MailboxReadContext,
    message: ExternalMailMessageRef,
  ): Promise<ExternalMailMessage> {
    const token = await this.#token(context);
    const result = await requestJson<GraphMessage>(
      `${this.#baseUrl}/messages/${encodeURIComponent(message.externalMessageKey)}?$select=id,immutableId,changeKey,receivedDateTime,subject,webLink,parentFolderId,conversationId,from,body,internetMessageHeaders`,
      this.#init(token, context),
    );
    const from = result.from?.emailAddress;
    const textBody =
      result.body?.contentType?.toLowerCase() === 'text'
        ? (result.body.content ?? '')
        : (result.body?.content ?? '');
    return externalMailMessageSchema.parse(
      safeMessage({
        ...message,
        subject: result.subject ?? '',
        fromName: from?.name ?? '',
        fromAddress: from?.address ?? '',
        textBody,
        htmlBody: result.body?.contentType?.toLowerCase() === 'html' ? textBody : null,
        calendarBody: null,
        headers: Object.fromEntries(
          (result.internetMessageHeaders ?? [])
            .filter((item) => item.name && item.value)
            .map((item) => [item.name!.toLowerCase(), item.value!]),
        ),
      }),
    );
  }

  public async healthCheck(context: MailboxReadContext): Promise<MailHealthResult> {
    await this.listFolders(context);
    return { status: 'healthy', checkedAt: Date.now() };
  }

  #ref(context: MailboxReadContext, item: GraphMessage): ExternalMailMessageRef {
    const key = item.immutableId ?? item.id;
    const receivedAt = Date.parse(item.receivedDateTime ?? '') || Date.now();
    return safeRef(
      externalMailMessageRefSchema.parse({
        mailboxKey: context.mailboxKey,
        providerKey: 'microsoft-graph',
        externalMessageKey: key,
        folderId: item.parentFolderId ?? 'inbox',
        threadKey: item.conversationId ?? null,
        receivedAt,
        contentVersion: item.changeKey ?? key,
        sourceUrl: item.webLink ?? null,
        changeKind: item.id ? 'added' : 'removed',
      }),
    );
  }

  async #token(context: MailboxReadContext): Promise<string> {
    const values = await credentialValue(context, this.#credentials);
    if (!values.accessToken)
      throw new MailConnectorError(
        'authentication_required',
        'Microsoft Graph access token is missing.',
      );
    return values.accessToken;
  }
  #init(token: string, context: MailboxReadContext): RequestInit & { timeoutMs: number } {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Prefer: 'IdType="ImmutableId"',
      },
      ...(context.signal ? { signal: context.signal } : {}),
      timeoutMs: context.timeoutMs ?? 30_000,
    };
  }
}

function graphFolderCursor(
  value: unknown,
  folderId: string,
): { deltaLink?: string; nextLink?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.folderId === folderId) {
    const flatDeltaLink = record.deltaLink;
    const flatNextLink = record.nextLink;
    return typeof flatDeltaLink === 'string' || typeof flatNextLink === 'string'
      ? {
          ...(typeof flatDeltaLink === 'string' ? { deltaLink: flatDeltaLink } : {}),
          ...(typeof flatNextLink === 'string' ? { nextLink: flatNextLink } : {}),
        }
      : null;
  }
  const folders = record.folders;
  if (!folders || typeof folders !== 'object') return null;
  const cursor = (folders as Record<string, unknown>)[folderId];
  if (!cursor || typeof cursor !== 'object') return null;
  const deltaLink = (cursor as Record<string, unknown>).deltaLink;
  const nextLink = (cursor as Record<string, unknown>).nextLink;
  return typeof deltaLink === 'string' || typeof nextLink === 'string'
    ? {
        ...(typeof deltaLink === 'string' ? { deltaLink } : {}),
        ...(typeof nextLink === 'string' ? { nextLink } : {}),
      }
    : null;
}
