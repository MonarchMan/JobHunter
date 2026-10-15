import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
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
import { credentialValue, safeMessage, safeRef } from './shared.js';

interface ImapCursor {
  folders?: Record<string, { uidValidity: string; lastUid: number; highestModSeq?: string }>;
}
interface ImapCredentials {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  tls?: string;
}

/** 通用 IMAP over TLS 连接器；所有邮箱操作使用 EXAMINE 和 BODY.PEEK，避免修改已读状态。 */
export class ImapConnector implements MailboxConnector {
  public readonly metadata = {
    providerKey: 'imap' as const,
    version: 'imap-tls-v1',
    authKind: 'app_password' as const,
    incrementalMode: 'imap_uid' as const,
    folderMode: 'folders' as const,
    supportsStableMessageId: true,
    supportStatus: 'experimental' as const,
  };
  readonly #credentials: (
    ref: string,
    signal?: AbortSignal,
  ) => Promise<Readonly<Record<string, string>>>;

  public constructor(
    credentials: (ref: string, signal?: AbortSignal) => Promise<Readonly<Record<string, string>>>,
  ) {
    this.#credentials = credentials;
  }

  public async listFolders(context: MailboxReadContext): Promise<readonly MailFolder[]> {
    const client = await this.#connect(context);
    try {
      const boxes = await client.list();
      return boxes.map((box) => ({
        id: box.path,
        displayName: box.name,
        kind: box.path.toUpperCase() === 'INBOX' ? 'inbox' : 'user',
        selectable: box.flags ? !box.flags.has('\\Noselect') : true,
      }));
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  public async *discoverChanges(
    context: MailboxReadContext,
    request: MailChangeRequest,
  ): AsyncIterable<MailChangePage> {
    const credentials = await this.#credentials(context.credentialRef, context.signal);
    const client = await this.#connect(context, credentials);
    try {
      const cursor = asImapCursor(request.cursor);
      for (const folder of request.folders) {
        const mailbox = await client.mailboxOpen(folder, { readOnly: true });
        const uidValidity = String(mailbox.uidValidity ?? '');
        const state = cursor?.folders?.[folder];
        if (state && state.uidValidity !== uidValidity)
          throw new MailConnectorError('cursor_invalid', 'IMAP UIDVALIDITY changed.');
        const lastUid = state?.lastUid ?? 0;
        const start = Math.max(lastUid + 1, 1);
        const end = mailbox.exists;
        const refs: ExternalMailMessageRef[] = [];
        if (end >= start) {
          for await (const item of client.fetch(
            `${String(start)}:*`,
            { uid: true, envelope: true, internalDate: true, flags: true },
            { uid: true },
          ))
            refs.push(this.#ref(context, folder, uidValidity, item));
        }
        yield {
          messages: refs,
          nextCursor: {
            folders: {
              [folder]: {
                uidValidity,
                lastUid: refs.at(-1)?.externalMessageKey.split(':').at(-1)
                  ? Number(refs.at(-1)!.externalMessageKey.split(':').at(-1))
                  : lastUid,
              },
            },
          },
          hasMore: false,
        };
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  public async fetchMessage(
    context: MailboxReadContext,
    message: ExternalMailMessageRef,
  ): Promise<ExternalMailMessage> {
    const credentials = await this.#credentials(context.credentialRef, context.signal);
    const client = await this.#connect(context, credentials);
    try {
      await client.mailboxOpen(message.folderId, { readOnly: true });
      const uid = Number(message.externalMessageKey.split(':').at(-1));
      const result = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!result || !result.source)
        throw new MailConnectorError('message_not_found', 'IMAP message was not found.');
      const parsed = await simpleParser(result.source);
      return externalMailMessageSchema.parse(
        safeMessage({
          ...message,
          subject: parsed.subject ?? '',
          fromName: parsed.from?.value?.[0]?.name ?? '',
          fromAddress: parsed.from?.value?.[0]?.address ?? '',
          textBody: parsed.text ?? '',
          htmlBody: typeof parsed.html === 'string' ? parsed.html : null,
          calendarBody:
            parsed.attachments
              .find((attachment) => attachment.contentType === 'text/calendar')
              ?.content.toString('utf8') ?? null,
          headers: Object.fromEntries(
            [...parsed.headers.entries()]
              .filter(([, value]) => typeof value === 'string')
              .map(([key, value]) => [key, String(value)]),
          ),
        }),
      );
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  public async healthCheck(context: MailboxReadContext): Promise<MailHealthResult> {
    const client = await this.#connect(context);
    await client.logout();
    return { status: 'healthy', checkedAt: Date.now() };
  }

  async #connect(
    context: MailboxReadContext,
    provided?: Readonly<Record<string, string>>,
  ): Promise<ImapFlow> {
    const values = (provided ??
      (await credentialValue(context, this.#credentials))) as ImapCredentials;
    if (!values.host || !values.user || !values.password)
      throw new MailConnectorError('invalid_config', 'IMAP host, user and password are required.');
    const client = new ImapFlow({
      host: values.host,
      port: Number(values.port ?? 993),
      secure: values.tls !== 'starttls',
      auth: { user: values.user, pass: values.password },
      logger: false,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      throw new MailConnectorError('network_temporary', 'Unable to connect to IMAP over TLS.', {
        cause: error,
      });
    }
  }

  #ref(
    context: MailboxReadContext,
    folder: string,
    uidValidity: string,
    item: FetchMessageObject,
  ): ExternalMailMessageRef {
    const receivedAt = item.internalDate?.valueOf() ?? Date.now();
    return safeRef(
      externalMailMessageRefSchema.parse({
        mailboxKey: context.mailboxKey,
        providerKey: 'imap',
        externalMessageKey: `${folder}:${uidValidity}:${String(item.uid)}`,
        folderId: folder,
        threadKey: item.envelope?.messageId ?? null,
        receivedAt,
        contentVersion: `${uidValidity}:${String(item.uid)}`,
        sourceUrl: null,
        changeKind: 'added',
      }),
    );
  }
}

function asImapCursor(value: unknown): ImapCursor | null {
  if (!value || typeof value !== 'object') return null;
  return value as ImapCursor;
}
