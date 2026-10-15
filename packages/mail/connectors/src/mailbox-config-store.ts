import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  mailboxConfigDocumentSchema,
  mailboxConfigSchema,
  type MailboxConfig,
  type MailboxConfigDocument,
} from '@jobhunter/mail-core';

/** 本地邮箱非敏感配置的文件端口；所有写入均经过 Schema 和原子替换。 */
export interface MailboxConfigStore {
  list(): Promise<readonly MailboxConfig[]>;
  upsert(config: MailboxConfig): Promise<void>;
  remove(mailboxKey: string): Promise<void>;
}

/** 将邮箱配置保存到指定 JSON 文件，不保存授权码、Token 或邮件正文。 */
export class FileMailboxConfigStore implements MailboxConfigStore {
  readonly #filePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    this.#filePath = path.resolve(filePath);
  }

  /** 返回配置文件路径，供本地设置页展示实际存储位置。 */
  public get filePath(): string {
    return this.#filePath;
  }

  public async list(): Promise<readonly MailboxConfig[]> {
    return (await this.#read()).mailboxes;
  }

  public async upsert(config: MailboxConfig): Promise<void> {
    const value = mailboxConfigSchema.parse(config);
    await this.#enqueue(async () => {
      const document = await this.#read();
      const index = document.mailboxes.findIndex((item) => item.mailboxKey === value.mailboxKey);
      if (index < 0) document.mailboxes.push(value);
      else document.mailboxes[index] = value;
      await this.#write(document);
    });
  }

  public async remove(mailboxKey: string): Promise<void> {
    await this.#enqueue(async () => {
      const document = await this.#read();
      const next = document.mailboxes.filter((item) => item.mailboxKey !== mailboxKey);
      if (next.length === document.mailboxes.length) return;
      await this.#write({ version: 1, mailboxes: next });
    });
  }

  async #read(): Promise<MailboxConfigDocument> {
    try {
      const text = await readFile(this.#filePath, 'utf8');
      return mailboxConfigDocumentSchema.parse(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, mailboxes: [] };
      }
      throw error;
    }
  }

  async #write(document: MailboxConfigDocument): Promise<void> {
    const value = mailboxConfigDocumentSchema.parse(document);
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.#filePath);
  }

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const previous = this.#writeQueue;
    let release!: () => void;
    this.#writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await operation();
    } finally {
      release();
    }
  }
}
