import {
  mailboxConfigSchema,
  type MailConnectorMetadata,
  type MailboxConfig,
  type MailboxRuntimeState,
  type WritableCredentialVault,
} from '@jobhunter/mail-core';
import { z } from 'zod';

/** 设置页提交的 IMAP/QQ 连接参数；password 只在本次请求中存在。 */
export const imapMailboxCreateSchema = z
  .object({
    preset: z.enum(['qq', 'custom']),
    address: z.email().max(320),
    password: z.string().min(1).max(1024),
    host: z
      .string()
      .trim()
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/)
      .optional(),
    port: z.coerce.number().int().min(1).max(65_535).default(993),
    tls: z.enum(['ssl', 'starttls']).default('ssl'),
    folders: z.array(z.string().trim().min(1).max(512)).min(1).max(20).default(['INBOX']),
    initialLookbackDays: z.number().int().min(1).max(365).default(30),
  })
  .superRefine((input, context) => {
    if (input.preset === 'custom' && !input.host) {
      context.addIssue({
        code: 'custom',
        path: ['host'],
        message: 'Custom IMAP host is required.',
      });
    }
  });
export type ImapMailboxCreateInput = z.infer<typeof imapMailboxCreateSchema>;

/** OAuth 回调完成后提交的邮箱身份和短生命周期令牌；令牌只会写入加密凭据文件。 */
export const oauthMailboxCreateSchema = z
  .object({
    providerKey: z.enum(['gmail', 'microsoft-graph']),
    address: z.email().max(320),
    accessToken: z.string().min(1).max(16_384),
    refreshToken: z.string().max(16_384).nullable(),
    expiresAt: z.number().int().nonnegative().nullable(),
    scope: z.string().max(4096),
    tokenType: z.string().min(1).max(128),
    folders: z.array(z.string().trim().min(1).max(512)).min(1).max(20),
    initialLookbackDays: z.number().int().min(1).max(365).default(30),
  })
  .strict();
export type OAuthMailboxCreateInput = z.infer<typeof oauthMailboxCreateSchema>;

/** 设置页允许修改的邮箱字段；newPassword 只用于覆盖凭据库中的旧授权码。 */
export const mailboxSettingsUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    folders: z.array(z.string().trim().min(1).max(512)).min(1).max(20).optional(),
    initialLookbackDays: z.number().int().min(1).max(365).optional(),
    newPassword: z.string().min(1).max(1024).optional(),
  })
  .strict();
export type MailboxSettingsUpdate = z.infer<typeof mailboxSettingsUpdateSchema>;

/** 邮箱配置存储端口；实现可以是本地 JSON 文件或未来的其他本地存储。 */
export interface MailboxConfigStorePort {
  list(): Promise<readonly MailboxConfig[]>;
  upsert(config: MailboxConfig): Promise<void>;
  remove(mailboxKey: string): Promise<void>;
  readonly filePath?: string;
}

/** 游标状态的最小读取端口，避免设置页依赖连接器实现。 */
export interface MailboxRuntimeStatePort {
  read(mailboxKey: string): Promise<MailboxRuntimeState | null>;
  remove?(mailboxKey: string): Promise<void>;
}

/** 设置页展示的脱敏邮箱状态。 */
export interface MailboxSettingsView {
  readonly mailboxKey: string;
  readonly providerKey: MailboxConfig['providerKey'];
  readonly maskedAddress: string;
  readonly folders: readonly string[];
  readonly initialLookbackDays: number;
  readonly enabled: boolean;
  readonly supportStatus: MailConnectorMetadata['supportStatus'];
  readonly syncStatus: 'not_synced' | 'ready' | 'auth_required' | 'failed';
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastErrorCategory: string | null;
}

/** Web 邮箱配置及运行状态总览。 */
export interface MailboxSettingsSnapshot {
  readonly configurationPath: string | null;
  readonly mailboxes: readonly MailboxSettingsView[];
}

/** 统一的邮箱设置错误，HTTP 层只需映射固定错误码。 */
export class MailboxSettingsError extends Error {
  public constructor(
    public readonly code: 'not_found' | 'invalid' | 'credential_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'MailboxSettingsError';
  }
}

/** 管理邮箱非敏感配置和加密凭据引用，不执行实际邮件网络同步。 */
export class MailboxSettingsService {
  readonly #configs: MailboxConfigStorePort;
  readonly #credentials: WritableCredentialVault;
  readonly #runtimeState: MailboxRuntimeStatePort;
  readonly #metadata: ReadonlyMap<MailboxConfig['providerKey'], MailConnectorMetadata>;
  readonly #createMailboxKey: () => string;

  public constructor(input: {
    readonly configs: MailboxConfigStorePort;
    readonly credentials: WritableCredentialVault;
    readonly runtimeState: MailboxRuntimeStatePort;
    readonly metadata: readonly MailConnectorMetadata[];
    readonly createMailboxKey: () => string;
  }) {
    this.#configs = input.configs;
    this.#credentials = input.credentials;
    this.#runtimeState = input.runtimeState;
    this.#metadata = new Map(input.metadata.map((item) => [item.providerKey, item] as const));
    this.#createMailboxKey = input.createMailboxKey;
  }

  /** 返回设置页所需的脱敏邮箱列表，不读取凭据正文。 */
  public async snapshot(): Promise<MailboxSettingsSnapshot> {
    const mailboxes = await this.#configs.list();
    const views = await Promise.all(mailboxes.map((mailbox) => this.#view(mailbox)));
    return { configurationPath: this.#configs.filePath ?? null, mailboxes: views };
  }

  /**
   * 受控读取已保存的 IMAP 授权码；普通邮箱快照不会包含凭据值。
   * OAuth access token 与 refresh token 始终不允许回传到 Web。
   */
  public async readCredential(mailboxKey: string): Promise<string> {
    // 1、确认邮箱存在且是允许回显授权码的 IMAP 连接。
    const mailbox = await this.#find(mailboxKey);
    if (mailbox.providerKey !== 'imap') {
      throw new MailboxSettingsError(
        'credential_unavailable',
        '该邮箱使用 OAuth 凭据，不支持回显。',
      );
    }
    // 2、只读取凭据库中的 password 字段，不把其他字段暴露给 Web。
    let values: Readonly<Record<string, string>>;
    try {
      values = await this.#credentials.get(mailbox.credentialRef);
    } catch {
      throw new MailboxSettingsError('credential_unavailable', '已保存的邮箱凭据不可用。');
    }
    const password = values.password;
    if (typeof password !== 'string' || password.length === 0) {
      throw new MailboxSettingsError('credential_unavailable', '已保存的 IMAP 授权码不可用。');
    }
    return password;
  }

  /** 保存一条 IMAP/QQ 配置，并把应用专用密码写入加密凭据文件。 */
  public async createImap(input: ImapMailboxCreateInput): Promise<MailboxSettingsView> {
    const value = imapMailboxCreateSchema.parse(input);
    const mailboxKey = `imap-${this.#createMailboxKey()}`;
    const credentialRef = `os:jobhunter/mail/${mailboxKey}`;
    const config = mailboxConfigSchema.parse({
      mailboxKey,
      providerKey: 'imap',
      maskedAddress: maskAddress(value.address),
      credentialRef,
      folders: value.folders,
      initialLookbackDays: value.initialLookbackDays,
      enabled: true,
    });
    const credentialValues = {
      host: value.preset === 'qq' ? 'imap.qq.com' : (value.host ?? ''),
      port: String(value.port),
      user: value.address,
      password: value.password,
      tls: value.tls,
    };
    // 1、先写入凭据；2、再写入不含秘密的配置；3、配置失败时撤销刚写入的凭据。
    await this.#credentials.put(credentialRef, credentialValues);
    try {
      await this.#configs.upsert(config);
    } catch (error) {
      await this.#credentials.revoke(credentialRef).catch(() => undefined);
      throw error;
    }
    return this.#view(config);
  }

  /** 保存 OAuth 邮箱配置，并把访问令牌和刷新令牌写入加密凭据文件。 */
  public async createOAuth(input: OAuthMailboxCreateInput): Promise<MailboxSettingsView> {
    const value = oauthMailboxCreateSchema.parse(input);
    const mailboxKey = `${value.providerKey}-${this.#createMailboxKey()}`;
    const credentialRef = `os:jobhunter/mail/${mailboxKey}`;
    const config = mailboxConfigSchema.parse({
      mailboxKey,
      providerKey: value.providerKey,
      maskedAddress: maskAddress(value.address),
      credentialRef,
      folders: value.folders,
      initialLookbackDays: value.initialLookbackDays,
      enabled: true,
    });
    const credentialValues = {
      accessToken: value.accessToken,
      ...(value.refreshToken === null ? {} : { refreshToken: value.refreshToken }),
      ...(value.expiresAt === null ? {} : { expiresAt: String(value.expiresAt) }),
      scope: value.scope,
      tokenType: value.tokenType,
    };
    // 1、令牌先进入加密凭据文件；2、再保存不含秘密的配置；3、配置失败时撤销令牌。
    await this.#credentials.put(credentialRef, credentialValues);
    try {
      await this.#configs.upsert(config);
    } catch (error) {
      await this.#credentials.revoke(credentialRef).catch(() => undefined);
      throw error;
    }
    return this.#view(config);
  }

  /** 修改启停、文件夹、回溯范围，并可安全覆盖凭据库中的授权码。 */
  public async update(
    mailboxKey: string,
    input: MailboxSettingsUpdate,
  ): Promise<MailboxSettingsView> {
    const current = await this.#find(mailboxKey);
    const mutation = mailboxSettingsUpdateSchema.parse(input);
    const next = mailboxConfigSchema.parse({
      ...current,
      ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
      ...(mutation.folders === undefined ? {} : { folders: mutation.folders }),
      ...(mutation.initialLookbackDays === undefined
        ? {}
        : { initialLookbackDays: mutation.initialLookbackDays }),
    });
    // 1、需要更新授权码时，仅在服务端读取并合并旧凭据，任何凭据值都不进入返回结果。
    let previousCredentials: Readonly<Record<string, string>> | null = null;
    if (mutation.newPassword !== undefined) {
      try {
        previousCredentials = await this.#credentials.get(current.credentialRef);
      } catch {
        throw new MailboxSettingsError('credential_unavailable', '已保存的邮箱凭据不可用。');
      }
      await this.#credentials.put(current.credentialRef, {
        ...previousCredentials,
        password: mutation.newPassword,
      });
    }
    // 2、写入非敏感配置；若文件写入失败，恢复本次更新前的凭据，避免两处状态不一致。
    try {
      await this.#configs.upsert(next);
    } catch (error) {
      if (previousCredentials !== null) {
        await this.#credentials
          .put(current.credentialRef, previousCredentials)
          .catch(() => undefined);
      }
      throw error;
    }
    return this.#view(next);
  }

  /** 断开邮箱：先撤销凭据，再移除配置和游标；重复调用保持幂等。 */
  public async disconnect(mailboxKey: string): Promise<void> {
    const current = await this.#find(mailboxKey);
    await this.#credentials.revoke(current.credentialRef);
    await this.#configs.remove(mailboxKey);
    await this.#runtimeState.remove?.(mailboxKey);
  }

  async #find(mailboxKey: string): Promise<MailboxConfig> {
    const value = (await this.#configs.list()).find((item) => item.mailboxKey === mailboxKey);
    if (!value) throw new MailboxSettingsError('not_found', '邮箱配置不存在。');
    return value;
  }

  async #view(config: MailboxConfig): Promise<MailboxSettingsView> {
    const runtime = await this.#runtimeState.read(config.mailboxKey);
    return {
      mailboxKey: config.mailboxKey,
      providerKey: config.providerKey,
      maskedAddress: config.maskedAddress,
      folders: config.folders,
      initialLookbackDays: config.initialLookbackDays,
      enabled: config.enabled,
      supportStatus: this.#metadata.get(config.providerKey)?.supportStatus ?? 'experimental',
      syncStatus: syncStatus(runtime),
      lastSuccessAt: runtime?.lastSuccessAt ?? null,
      lastFailureAt: runtime?.lastFailureAt ?? null,
      lastErrorCategory: runtime?.lastErrorCategory ?? null,
    };
  }
}

function maskAddress(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) throw new MailboxSettingsError('invalid', '邮箱地址无效。');
  return `${local.slice(0, 1)}***@${domain}`;
}

function syncStatus(state: MailboxRuntimeState | null): MailboxSettingsView['syncStatus'] {
  if (!state) return 'not_synced';
  if (state.lastErrorCategory === 'authentication_required') return 'auth_required';
  if (
    state.lastFailureAt !== null &&
    (state.lastSuccessAt === null || state.lastFailureAt > state.lastSuccessAt)
  )
    return 'failed';
  return 'ready';
}
