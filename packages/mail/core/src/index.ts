import { z } from 'zod';

/** 邮箱连接器支持的提供商标识。 */
export const mailProviderKeySchema = z.enum(['gmail', 'microsoft-graph', 'imap']);
export type MailProviderKey = z.infer<typeof mailProviderKeySchema>;

/** 连接器授权方式。 */
export const mailAuthKindSchema = z.enum(['oauth', 'app_password']);
export type MailAuthKind = z.infer<typeof mailAuthKindSchema>;

/** 连接器增量机制。 */
export const mailIncrementalModeSchema = z.enum(['history', 'delta', 'imap_uid']);
export type MailIncrementalMode = z.infer<typeof mailIncrementalModeSchema>;

/** 连接器公开能力与发布状态。 */
export const mailConnectorMetadataSchema = z.object({
  providerKey: mailProviderKeySchema,
  version: z.string().min(1),
  authKind: mailAuthKindSchema,
  incrementalMode: mailIncrementalModeSchema,
  folderMode: z.enum(['labels', 'folders']),
  supportsStableMessageId: z.boolean(),
  supportStatus: z.enum(['experimental', 'supported', 'blocked']),
});
export type MailConnectorMetadata = z.infer<typeof mailConnectorMetadataSchema>;

/** 本地非敏感邮箱配置；秘密只通过 credentialRef 访问。 */
export const mailboxConfigSchema = z.object({
  mailboxKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  providerKey: mailProviderKeySchema,
  maskedAddress: z.string().min(1).max(320),
  credentialRef: z.string().min(1).max(512),
  folders: z.array(z.string().min(1).max(512)).min(1),
  initialLookbackDays: z.number().int().min(1).max(365).default(90),
  enabled: z.boolean().default(true),
});
export type MailboxConfig = z.infer<typeof mailboxConfigSchema>;

/** 邮箱配置文件的版本化文档；同一文件内的 mailboxKey 必须唯一。 */
export const mailboxConfigDocumentSchema = z
  .object({ version: z.literal(1), mailboxes: z.array(mailboxConfigSchema) })
  .superRefine((document, context) => {
    const keys = new Set<string>();
    for (const [index, mailbox] of document.mailboxes.entries()) {
      if (keys.has(mailbox.mailboxKey)) {
        context.addIssue({
          code: 'custom',
          path: ['mailboxes', index, 'mailboxKey'],
          message: 'mailboxKey must be unique.',
        });
      }
      keys.add(mailbox.mailboxKey);
    }
  });
export type MailboxConfigDocument = z.infer<typeof mailboxConfigDocumentSchema>;

/** 运行时状态文件中的单邮箱状态；cursor 只由对应连接器解释。 */
export const mailboxRuntimeStateSchema = z.object({
  generation: z.number().int().nonnegative(),
  connectorVersion: z.string().min(1),
  cursor: z.unknown().nullable(),
  lastSuccessAt: z.number().int().nonnegative().nullable(),
  lastFailureAt: z.number().int().nonnegative().nullable(),
  lastErrorCategory: z.string().nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type MailboxRuntimeState = z.infer<typeof mailboxRuntimeStateSchema>;

/** 邮箱文件夹或 Gmail 标签。 */
export const mailFolderSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  kind: z.enum(['inbox', 'user', 'system']).default('user'),
  selectable: z.boolean().default(true),
});
export type MailFolder = z.infer<typeof mailFolderSchema>;

/** 发现阶段返回的最小稳定邮件身份。 */
export const externalMailMessageRefSchema = z.object({
  mailboxKey: z.string().min(1),
  providerKey: mailProviderKeySchema,
  externalMessageKey: z.string().min(1),
  folderId: z.string().min(1),
  threadKey: z.string().nullable(),
  receivedAt: z.number().int().nonnegative(),
  contentVersion: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  changeKind: z.enum(['added', 'updated', 'removed']).default('added'),
});
export type ExternalMailMessageRef = z.infer<typeof externalMailMessageRefSchema>;

/** 按需读取的有界邮件内容；连接器不得在日志中输出这些字段。 */
export const externalMailMessageSchema = externalMailMessageRefSchema.extend({
  subject: z.string().max(1000),
  fromName: z.string().max(320),
  fromAddress: z.string().max(320),
  textBody: z.string().max(200_000),
  htmlBody: z.string().max(400_000).nullable(),
  headers: z.record(z.string(), z.string().max(2000)).default({}),
});
export type ExternalMailMessage = z.infer<typeof externalMailMessageSchema>;

/** 单页增量结果。nextCursor 为不透明连接器游标。 */
export interface MailChangePage {
  readonly messages: readonly ExternalMailMessageRef[];
  readonly nextCursor: unknown | null;
  readonly hasMore: boolean;
}

/** 增量发现请求。 */
export interface MailChangeRequest {
  readonly mailboxKey: string;
  readonly folders: readonly string[];
  readonly cursor: unknown | null;
  readonly lookbackDays: number;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

/** 读取上下文，避免凭据值进入业务层。 */
export interface MailboxReadContext {
  readonly mailboxKey: string;
  readonly credentialRef: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** 连接器健康状态。 */
export interface MailHealthResult {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly checkedAt: number;
  readonly errorCategory?: MailErrorCategory;
}

/** 稳定错误类别，应用层据此决定暂停、重试或重建游标。 */
export const mailErrorCategorySchema = z.enum([
  'authentication_required',
  'permission_denied',
  'rate_limited',
  'network_temporary',
  'upstream_5xx',
  'cursor_invalid',
  'message_not_found',
  'parse_changed',
  'invalid_config',
  'payload_too_large',
  'cancelled',
]);
export type MailErrorCategory = z.infer<typeof mailErrorCategorySchema>;

/** 连接器统一错误，禁止把供应商原始响应正文带入诊断信息。 */
export class MailConnectorError extends Error {
  public readonly category: MailErrorCategory;

  public constructor(category: MailErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailConnectorError';
    this.category = category;
  }
}

/** 凭据库只暴露引用读取和撤销，不允许业务层接触持久化秘密。 */
export interface CredentialVault {
  get(ref: string, signal?: AbortSignal): Promise<Readonly<Record<string, string>>>;
  revoke(ref: string): Promise<void>;
}

/** 可写凭据库端口；秘密只在边界调用期间存在，不进入应用配置或任务。 */
export interface WritableCredentialVault extends CredentialVault {
  put(ref: string, values: Readonly<Record<string, string>>): Promise<void>;
}

/** 邮箱连接器公共端口。 */
export interface MailboxConnector {
  readonly metadata: MailConnectorMetadata;
  listFolders(context: MailboxReadContext): Promise<readonly MailFolder[]>;
  discoverChanges(
    context: MailboxReadContext,
    request: MailChangeRequest,
  ): AsyncIterable<MailChangePage>;
  fetchMessage(
    context: MailboxReadContext,
    message: ExternalMailMessageRef,
  ): Promise<ExternalMailMessage>;
  healthCheck(context: MailboxReadContext): Promise<MailHealthResult>;
}

/** 通过运行时 Schema 校验安全来源 URL，拒绝凭据和一次性访问令牌。 */
export function parseSafeMailSourceUrl(value: string | null | undefined): string | null {
  if (value == null || value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const blocked = /(?:token|access_token|refresh_token|auth|code|sig|signature)/i;
  for (const key of parsed.searchParams.keys()) if (blocked.test(key)) return null;
  return parsed.toString();
}

/** 连接器注册表，按 provider key 组装而不让应用层依赖具体实现。 */
export class MailConnectorRegistry {
  readonly #connectors = new Map<MailProviderKey, MailboxConnector>();

  /** 注册唯一 provider；重复注册通常表示装配错误。 */
  public register(connector: MailboxConnector): void {
    const metadata = mailConnectorMetadataSchema.parse(connector.metadata);
    if (this.#connectors.has(metadata.providerKey)) {
      throw new Error(`Mail connector already registered: ${metadata.providerKey}`);
    }
    this.#connectors.set(metadata.providerKey, connector);
  }

  /** 按 provider 获取连接器，不存在时返回 undefined。 */
  public get(providerKey: MailProviderKey): MailboxConnector | undefined {
    return this.#connectors.get(providerKey);
  }

  /** 返回当前已装配连接器的元数据快照。 */
  public metadata(): readonly MailConnectorMetadata[] {
    return [...this.#connectors.values()].map((connector) => connector.metadata);
  }
}
