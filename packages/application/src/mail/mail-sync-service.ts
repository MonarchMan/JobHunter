import {
  mailboxConfigSchema,
  type ExternalMailMessageRef,
  type MailboxConnector,
  type MailboxReadContext,
  type MailboxConfig,
  type MailboxRuntimeState,
} from '@jobhunter/mail-core';

const DAY_IN_MILLISECONDS = 86_400_000;

/** 同步批次提交端口；实现必须先提交引用，再持久化游标。 */
export interface MailSyncRepository {
  saveMessageRefs(refs: readonly ExternalMailMessageRef[]): Promise<void>;
  enqueueClassification(refs: readonly ExternalMailMessageRef[]): Promise<void>;
}

/** 运行状态文件端口；游标是不透明 JSON，应用层不修改其内部结构。 */
export interface MailRuntimeStatePort {
  read(mailboxKey: string): Promise<MailboxRuntimeState | null>;
  write(mailboxKey: string, value: MailboxRuntimeState): Promise<void>;
}

/** 以“数据库提交后推进游标”的顺序执行单邮箱增量同步。 */
export class MailSyncService {
  readonly #repository: MailSyncRepository;
  readonly #runtimeState: MailRuntimeStatePort;
  readonly #now: () => number;

  public constructor(
    repository: MailSyncRepository,
    runtimeState: MailRuntimeStatePort,
    now: () => number = Date.now,
  ) {
    this.#repository = repository;
    this.#runtimeState = runtimeState;
    this.#now = now;
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
    // 1、只有连接器版本一致且最近成功定位仍在回溯窗口内时，才续用不透明游标。
    let cursor: unknown = reusableCursor(
      previous,
      connector.metadata.version,
      config.initialLookbackDays,
      this.#now(),
    );
    for await (const page of connector.discoverChanges(context, {
      mailboxKey: config.mailboxKey,
      folders: config.folders,
      cursor,
      lookbackDays: config.initialLookbackDays,
    })) {
      // 2、先写最小引用并发布分类任务；两步都完成后才允许推进文件游标。
      await this.#repository.saveMessageRefs(page.messages);
      await this.#repository.enqueueClassification(page.messages);
      pages += 1;
      messages += page.messages.length;
      cursor = page.nextCursor;
      const committedAt = this.#now();
      // 3、数据库副作用完成后，才原子写入新游标及其成功定位时间。
      await this.#runtimeState.write(config.mailboxKey, {
        generation: (previous?.generation ?? 0) + 1,
        cursor,
        connectorVersion: connector.metadata.version,
        lastSuccessAt: committedAt,
        lastFailureAt: previous?.lastFailureAt ?? null,
        lastErrorCategory: null,
        updatedAt: committedAt,
      });
      if (!page.hasMore) break;
    }
    return { pages, messages, cursor };
  }
}

/** 过期或无法由当前连接器解释的游标必须回退到有界扫描，避免补扫整个邮箱。 */
function reusableCursor(
  state: MailboxRuntimeState | null,
  connectorVersion: string,
  lookbackDays: number,
  now: number,
): unknown {
  if (
    state?.cursor == null ||
    state.connectorVersion !== connectorVersion ||
    state.lastSuccessAt === null
  )
    return null;
  const boundedDays = Math.min(Math.max(lookbackDays, 1), 365);
  return state.lastSuccessAt >= now - boundedDays * DAY_IN_MILLISECONDS ? state.cursor : null;
}
