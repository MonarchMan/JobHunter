import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
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
import { imapConnectorMetadata } from './metadata.js';

interface ImapCursor {
  /** Zod 对可选字段可能显式返回 undefined，因此边界类型需要接受该形态。 */
  folders?:
    | Record<string, { uidValidity: string; lastUid: number; highestModSeq?: string | undefined }>
    | undefined;
}

const imapCursorSchema = z.object({
  folders: z
    .record(
      z.string(),
      z.object({
        uidValidity: z.string(),
        lastUid: z.number().int().nonnegative(),
        highestModSeq: z.string().optional(),
      }),
    )
    .optional(),
});
interface ImapCredentials {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  tls?: string;
}

/** 通用 IMAP over TLS 连接器；所有邮箱操作使用 EXAMINE 和 BODY.PEEK，避免修改已读状态。 */
export class ImapConnector implements MailboxConnector {
  public readonly metadata = imapConnectorMetadata;
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
        selectable: !box.flags.has('\\Noselect'),
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
      const folders = request.folders;
      const nextFolders = { ...(cursor?.folders ?? {}) };
      for (const [folderIndex, folder] of folders.entries()) {
        const mailbox = await client.mailboxOpen(folder, { readOnly: true });
        const uidValidity = String(mailbox.uidValidity);
        const state = cursor?.folders?.[folder];
        if (state && state.uidValidity !== uidValidity)
          throw new MailConnectorError('cursor_invalid', 'IMAP UIDVALIDITY changed.');
        const lastUid = state?.lastUid ?? 0;
        const start = Math.max(lastUid + 1, 1);
        const refs: ExternalMailMessageRef[] = [];
        const boundedDays = Math.min(Math.max(request.lookbackDays, 1), 365);
        const receivedAfter = Date.now() - boundedDays * 86_400_000;
        // 1、已有游标时只读新增 UID；2、首次或重建时由服务器按日期搜索，禁止从 UID 1 扫完整邮箱。
        let range: string | number[];
        if (state) {
          range = start < mailbox.uidNext ? `${String(start)}:*` : [];
        } else {
          const initialUids = await client.search(
            { since: new Date(receivedAfter) },
            { uid: true },
          );
          range = initialUids === false ? [] : initialUids;
        }
        if (mailbox.exists > 0 && (typeof range === 'string' || range.length > 0)) {
          for await (const item of client.fetch(
            range,
            { uid: true, envelope: true, internalDate: true, flags: true },
            { uid: true },
          ))
            if (state || new Date(item.internalDate ?? Date.now()).valueOf() >= receivedAfter) {
              refs.push(this.#ref(context, folder, uidValidity, item));
            }
        }
        const discoveredLastUid = refs.at(-1)?.externalMessageKey.split(':').at(-1);
        nextFolders[folder] = {
          uidValidity,
          // 初始扫描完成后直接锚定打开邮箱时的末尾，下一轮只读取此后到达的 UID。
          lastUid: state
            ? discoveredLastUid
              ? Number(discoveredLastUid)
              : lastUid
            : Math.max(mailbox.uidNext - 1, 0),
          ...(mailbox.highestModseq ? { highestModSeq: String(mailbox.highestModseq) } : {}),
        };
        yield {
          messages: refs,
          nextCursor: { folders: { ...nextFolders } },
          hasMore: folderIndex < folders.length - 1,
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
      const mailbox = await client.mailboxOpen(message.folderId, { readOnly: true });
      const keySegments = message.externalMessageKey.split(':');
      const uid = Number(keySegments.at(-1));
      const expectedUidValidity = keySegments.at(-2);
      if (
        !Number.isSafeInteger(uid) ||
        uid < 1 ||
        expectedUidValidity !== String(mailbox.uidValidity)
      ) {
        throw new MailConnectorError('cursor_invalid', 'IMAP message identity is no longer valid.');
      }
      // 1、先读取信封和 BODYSTRUCTURE；2、只选择非附件的 text/plain 或 text/html 部件。
      const metadata = await client.fetchOne(
        String(uid),
        { uid: true, envelope: true, bodyStructure: true },
        { uid: true },
      );
      if (!metadata || !metadata.bodyStructure)
        throw new MailConnectorError('message_not_found', 'IMAP message was not found.');
      const parts = selectBodyParts(metadata.bodyStructure);
      const result =
        parts.length === 0
          ? metadata
          : await client.fetchOne(
              String(uid),
              {
                uid: true,
                bodyParts: parts.map((part) => ({
                  key: part.part,
                  maxLength: part.type === 'text/plain' ? 200_000 : 400_000,
                })),
              },
              { uid: true },
            );
      if (!result) throw new MailConnectorError('message_not_found', 'IMAP message was not found.');
      const parsedBodies = await parseSelectedBodies(parts, result.bodyParts ?? new Map());
      const from = metadata.envelope?.from?.[0];
      return externalMailMessageSchema.parse(
        safeMessage({
          ...message,
          subject: metadata.envelope?.subject ?? '',
          fromName: from?.name ?? '',
          fromAddress: from?.address ?? '',
          textBody: parsedBodies.text,
          htmlBody: parsedBodies.html,
          headers: {},
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

interface SelectedBodyPart {
  readonly part: string;
  readonly type: 'text/plain' | 'text/html';
  readonly charset: string | null;
  readonly encoding: string | null;
}

/** 遍历 BODYSTRUCTURE，只保留正文文本，明确排除附件、日历和嵌套邮件。 */
function selectBodyParts(root: MessageStructureObject): readonly SelectedBodyPart[] {
  const selected: SelectedBodyPart[] = [];
  const visit = (node: MessageStructureObject, isRoot = false): void => {
    // 1、先排除整棵附件/嵌套邮件子树，避免误把附件中的 text/plain 当成当前正文。
    const type = node.type.toLocaleLowerCase();
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
    if (
      type === 'message/rfc822' ||
      node.disposition?.toLocaleLowerCase() === 'attachment' ||
      filename
    )
      return;
    // 2、只遍历正文容器；容器本身没有部件编号时仍需处理其非附件子部件。
    for (const child of node.childNodes ?? []) visit(child);
    const part = node.part ?? (isRoot ? '1' : null);
    if (!part || (type !== 'text/plain' && type !== 'text/html')) {
      return;
    }
    selected.push({
      part,
      type,
      charset: node.parameters?.charset ?? null,
      encoding: node.encoding ?? null,
    });
  };
  visit(root, true);
  return selected;
}

/** 使用 MIME 解码器处理选中的正文部件，不把完整邮件或附件交给解析器。 */
async function parseSelectedBodies(
  parts: readonly SelectedBodyPart[],
  values: ReadonlyMap<string, Buffer>,
): Promise<{ readonly text: string; readonly html: string | null }> {
  let text = '';
  let html: string | null = null;
  for (const part of parts) {
    const value = values.get(part.part);
    if (!value) continue;
    const headers = [
      `Content-Type: ${part.type}${part.charset ? `; charset=${JSON.stringify(part.charset)}` : ''}`,
      ...(part.encoding ? [`Content-Transfer-Encoding: ${part.encoding}`] : []),
      '',
      '',
    ].join('\r\n');
    const parsed = await simpleParser(Buffer.concat([Buffer.from(headers, 'ascii'), value]));
    if (part.type === 'text/plain' && !text) text = parsed.text ?? '';
    if (part.type === 'text/html' && html === null) {
      html = typeof parsed.html === 'string' ? parsed.html : null;
    }
  }
  return { text, html };
}

function asImapCursor(value: unknown): ImapCursor | null {
  const parsed = imapCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
