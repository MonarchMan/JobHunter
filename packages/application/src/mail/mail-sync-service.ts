import {
  mailboxConfigSchema,
  type ExternalMailMessageRef,
  type MailboxConnector,
  type MailboxReadContext,
  type MailboxConfig,
} from '@jobhunter/mail-core';

/** 同步批次提交端口；实现必须先提交引用，再持久化游标。 */
export interface MailSyncRepository {
  saveMessageRefs(refs: readonly ExternalMailMessageRef[]): Promise<void>;
  enqueueClassification(refs: readonly ExternalMailMessageRef[]): Promise<void>;
}

/** 运行状态文件端口；游标是不透明 JSON，应用层不修改其内部结构。 */
export interface MailRuntimeStatePort {
  read(mailboxKey: string): Promise<{
    readonly generation: number;
    readonly cursor: unknown;
  } | null>;
  write(
    mailboxKey: string,
    value: {
      readonly generation: number;
      readonly cursor: unknown;
      readonly connectorVersion: string;
    },
  ): Promise<void>;
}

/** 以“数据库提交后推进游标”的顺序执行单邮箱增量同步。 */
export class MailSyncService {
  readonly #repository: MailSyncRepository;
  readonly #runtimeState: MailRuntimeStatePort;

  public constructor(repository: MailSyncRepository, runtimeState: MailRuntimeStatePort) {
    this.#repository = repository;
    this.#runtimeState = runtimeState;
  }

  /** 1、读取状态；2、逐页保存引用并入队；3、页提交后原子推进游标。 */
  public async sync(
    configInput: MailboxConfig,
    connector: MailboxConnector,
    credentialRef: string,
    signal?: AbortSignal,
  ): Promise<{ pages: number; messages: number; cursor: unknown }> {
    const config = mailboxConfigSchema.parse(configInput);
    const previous = await this.#runtimeState.read(config.mailboxKey);
    const context: MailboxReadContext = {
      mailboxKey: config.mailboxKey,
      credentialRef,
      ...(signal ? { signal } : {}),
    };
    let pages = 0;
    let messages = 0;
    let cursor: unknown = previous?.cursor ?? null;
    for await (const page of connector.discoverChanges(context, {
      mailboxKey: config.mailboxKey,
      folders: config.folders,
      cursor,
      lookbackDays: config.initialLookbackDays,
    })) {
      // 1、先写最小引用并发布分类任务；两步都完成后才允许推进文件游标。
      await this.#repository.saveMessageRefs(page.messages);
      await this.#repository.enqueueClassification(page.messages);
      pages += 1;
      messages += page.messages.length;
      cursor = page.nextCursor;
      await this.#runtimeState.write(config.mailboxKey, {
        generation: (previous?.generation ?? 0) + 1,
        cursor,
        connectorVersion: connector.metadata.version,
      });
      if (!page.hasMore) break;
    }
    return { pages, messages, cursor };
  }
}
