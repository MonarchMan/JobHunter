import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mailboxRuntimeStateSchema, type MailboxRuntimeState } from '@jobhunter/mail-core';

/** 数据目录中的邮箱运行状态文件；仅保存游标和健康摘要，不保存凭据或邮件文本。 */
export class MailRuntimeStateStore {
  readonly #filePath: string;

  public constructor(dataRoot: string) {
    this.#filePath = path.resolve(dataRoot, 'mail', 'runtime-state.json');
  }

  /** 读取单个邮箱状态，文件不存在时返回空状态。 */
  public async read(mailboxKey: string): Promise<MailboxRuntimeState | null> {
    try {
      const document = JSON.parse(await readFile(this.#filePath, 'utf8')) as Record<
        string,
        unknown
      >;
      const value = document[mailboxKey];
      return value === undefined ? null : mailboxRuntimeStateSchema.parse(value);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 数据库提交完成后调用；临时文件加 rename 保证进程中断不留下半文件。 */
  public async write(mailboxKey: string, state: MailboxRuntimeState): Promise<void> {
    const value = mailboxRuntimeStateSchema.parse(state);
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    let document: Record<string, unknown> = {};
    try {
      document = JSON.parse(await readFile(this.#filePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    document[mailboxKey] = value;
    const temporaryPath = `${this.#filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.#filePath);
  }

  /** 断开邮箱时移除该邮箱游标；不存在状态时保持幂等。 */
  public async remove(mailboxKey: string): Promise<void> {
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(await readFile(this.#filePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (!(mailboxKey in document)) return;
    const remaining = Object.fromEntries(
      Object.entries(document).filter(([key]) => key !== mailboxKey),
    );
    const temporaryPath = `${this.#filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(remaining, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.#filePath);
  }
}
