import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WritableCredentialVault } from '@jobhunter/mail-core';
import { z } from 'zod';

const encryptedRecordSchema = z
  .object({
    algorithm: z.literal('aes-256-gcm'),
    iv: z.string().min(1),
    authTag: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();

const encryptedCredentialDocumentSchema = z
  .object({
    version: z.literal(1),
    records: z.record(z.string().min(1).max(512), encryptedRecordSchema),
  })
  .strict();

/** 仅含版本和密文记录的持久化文档，不保存任何凭据明文。 */
type EncryptedCredentialDocument = z.infer<typeof encryptedCredentialDocumentSchema>;

/** 加密凭据文件中不存在指定引用。 */
export class CredentialNotFoundError extends Error {
  public constructor() {
    super('Credential is unavailable.');
    this.name = 'CredentialNotFoundError';
  }
}

/** 使用 AES-256-GCM 将邮箱凭据保存为跨平台的原子加密文件。 */
export class EncryptedFileCredentialVault implements WritableCredentialVault {
  readonly #filePath: string;
  readonly #keyFilePath: string;
  readonly #configuredKey: Buffer | null;
  #keyPromise: Promise<Buffer> | null = null;
  #queue: Promise<void> = Promise.resolve();

  public constructor(input: {
    readonly filePath: string;
    readonly keyFilePath: string;
    readonly masterKey?: string;
  }) {
    this.#filePath = path.resolve(input.filePath);
    this.#keyFilePath = path.resolve(input.keyFilePath);
    if (this.#filePath === this.#keyFilePath) {
      throw new Error('Credential and key files must use different paths.');
    }
    this.#configuredKey = input.masterKey ? parseMasterKey(input.masterKey) : null;
  }

  /** 加密并原子保存指定凭据，不允许秘密进入普通邮箱配置。 */
  public put(ref: string, values: Readonly<Record<string, string>>): Promise<void> {
    const credentialRef = parseCredentialRef(ref);
    const validatedValues = credentialValuesSchema.parse(values);
    return this.#serialize(async () => {
      // 1、读取仅含密文的文档；2、为本条记录生成随机 IV；3、原子替换文件。
      const document = await this.#read();
      const key = await this.#key(Object.keys(document.records).length === 0);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(credentialRef));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(validatedValues), 'utf8'),
        cipher.final(),
      ]);
      document.records[credentialRef] = {
        algorithm: 'aes-256-gcm',
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
      await this.#write(document);
    });
  }

  /** 只解密指定引用对应的凭据记录。 */
  public get(ref: string): Promise<Readonly<Record<string, string>>> {
    const credentialRef = parseCredentialRef(ref);
    return this.#serialize(async () => {
      const record = (await this.#read()).records[credentialRef];
      if (!record) throw new CredentialNotFoundError();
      try {
        // 1、使用引用作为附加认证数据；2、验证认证标签后才解析凭据 JSON。
        const decipher = createDecipheriv(
          'aes-256-gcm',
          await this.#key(false),
          Buffer.from(record.iv, 'base64'),
        );
        decipher.setAAD(aad(credentialRef));
        decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8');
        return credentialValuesSchema.parse(JSON.parse(plaintext) as unknown);
      } catch (error) {
        if (error instanceof CredentialNotFoundError) throw error;
        throw new Error('Encrypted credential cannot be decrypted.');
      }
    });
  }

  /** 从加密文件移除指定凭据；不存在时保持幂等。 */
  public revoke(ref: string): Promise<void> {
    const credentialRef = parseCredentialRef(ref);
    return this.#serialize(async () => {
      const document = await this.#read();
      if (!document.records[credentialRef]) return;
      const records = Object.fromEntries(
        Object.entries(document.records).filter(([key]) => key !== credentialRef),
      );
      await this.#write({ version: 1, records });
    });
  }

  /** 串行化读写，避免并发更新覆盖其他邮箱的密文记录。 */
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 读取密文文档；文件不存在表示尚未保存任何凭据。 */
  async #read(): Promise<EncryptedCredentialDocument> {
    try {
      const text = await readFile(this.#filePath, 'utf8');
      return encryptedCredentialDocumentSchema.parse(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, records: {} };
      }
      throw error;
    }
  }

  /** 以仅当前用户可读写的临时文件完成原子替换。 */
  async #write(document: EncryptedCredentialDocument): Promise<void> {
    const value = encryptedCredentialDocumentSchema.parse(document);
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      // 1、排他创建临时密文；2、原子替换正式文件；3、失败时只清理本次临时文件。
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.#filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  /** 优先使用环境主密钥，否则创建独立密钥文件并限制文件权限。 */
  #key(allowCreate: boolean): Promise<Buffer> {
    if (this.#configuredKey) return Promise.resolve(this.#configuredKey);
    this.#keyPromise ??= loadOrCreateKey(this.#keyFilePath, allowCreate).catch((error: unknown) => {
      this.#keyPromise = null;
      throw error;
    });
    return this.#keyPromise;
  }
}

/** 一次性迁移旧后端到加密文件，校验成功后撤销旧副本；不用于运行时装配。 */
export class MigratingCredentialVault implements WritableCredentialVault {
  readonly #primary: WritableCredentialVault;
  readonly #legacy: WritableCredentialVault;

  public constructor(primary: WritableCredentialVault, legacy: WritableCredentialVault) {
    this.#primary = primary;
    this.#legacy = legacy;
  }

  public put(ref: string, values: Readonly<Record<string, string>>): Promise<void> {
    return this.#primary.put(ref, values);
  }

  /** 主动迁移指定旧凭据；新后端已有记录时不读取旧秘密，只清理残留。 */
  public async migrate(ref: string): Promise<boolean> {
    try {
      await this.#primary.get(ref);
      // 新密文已可验证时直接清理可能残留的旧副本，不再读取旧秘密。
      await this.#legacy.revoke(ref);
      return false;
    } catch (error) {
      if (!(error instanceof CredentialNotFoundError)) throw error;
    }

    // 1、读取旧凭据；2、写入并重新读取新密文；3、验证一致后才撤销旧副本。
    const values = await this.#legacy.get(ref);
    await this.#primary.put(ref, values);
    try {
      const persisted = await this.#primary.get(ref);
      if (!credentialValuesEqual(values, persisted)) {
        throw new Error('Migrated credential verification failed.');
      }
    } catch (error) {
      await this.#primary.revoke(ref).catch(() => undefined);
      throw error;
    }
    await this.#legacy.revoke(ref);
    return true;
  }

  /** 一次性按邮箱配置主动迁移全部引用，单条失败不阻断其他邮箱。 */
  public async migrateAll(refs: readonly string[]): Promise<{
    readonly migrated: number;
    readonly skipped: number;
    readonly failed: number;
  }> {
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    // 1、去重并逐条执行，避免同时读取旧后端或覆盖同一密文文件。
    for (const ref of new Set(refs)) {
      try {
        if (await this.migrate(ref)) migrated += 1;
        else skipped += 1;
      } catch {
        // 1.a、旧凭据缺失或迁移校验失败时保留旧副本，由维护操作重试。
        failed += 1;
      }
    }
    return { migrated, skipped, failed };
  }

  public async get(ref: string): Promise<Readonly<Record<string, string>>> {
    try {
      return await this.#primary.get(ref);
    } catch (error) {
      if (!(error instanceof CredentialNotFoundError)) throw error;
    }
    await this.migrate(ref);
    return this.#primary.get(ref);
  }

  public async revoke(ref: string): Promise<void> {
    await this.#primary.revoke(ref);
    await this.#legacy.revoke(ref).catch(() => undefined);
  }
}

const credentialValuesSchema = z.record(z.string(), z.string());

/** 校验稳定凭据引用，避免任意值进入文件键或认证数据。 */
function parseCredentialRef(ref: string): string {
  if (!/^os:jobhunter\/mail\/[A-Za-z0-9._-]+$/.test(ref))
    throw new Error('Invalid mailbox credential reference.');
  return ref;
}

/** 支持 32 字节 Base64 或 64 字符十六进制主密钥。 */
function parseMasterKey(value: string): Buffer {
  const normalized = value.trim();
  const key = /^[A-Fa-f0-9]{64}$/.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64');
  if (key.length !== 32) {
    throw new Error('Mailbox credential master key must contain exactly 32 bytes.');
  }
  return key;
}

/** 加载已有密钥，或以排他创建避免并发启动生成两个不同密钥。 */
async function loadOrCreateKey(filePath: string, allowCreate: boolean): Promise<Buffer> {
  // 1、优先读取原密钥；存在密文却缺失密钥时禁止生成替代密钥。
  try {
    return parseMasterKey(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (!allowCreate) throw new Error('Mailbox credential key file is unavailable.');
  // 2、仅首次保存时排他生成密钥，其他实例使用已创建的同一个密钥。
  await mkdir(path.dirname(filePath), { recursive: true });
  const generated = randomBytes(32).toString('base64');
  try {
    await writeFile(filePath, `${generated}\n`, { mode: 0o600, flag: 'wx' });
    return Buffer.from(generated, 'base64');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    return parseMasterKey(await readFile(filePath, 'utf8'));
  }
}

/** 将版本与引用绑定进认证数据，阻止密文记录被交换。 */
function aad(ref: string): Buffer {
  return Buffer.from(`jobhunter-mail-credential:v1:${ref}`, 'utf8');
}

/** 比较迁移前后的字符串字段，避免写入异常后过早删除唯一旧副本。 */
function credentialValuesEqual(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): boolean {
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(expectedEntries) === JSON.stringify(actualEntries);
}
