import type {
  ExternalMailMessage,
  MailChangeRequest,
  MailboxConfig,
  MailboxConnector,
  MailboxRuntimeState,
} from '@jobhunter/mail-core';
import { describe, expect, it } from 'vitest';
import {
  MailSyncService,
  type MailRuntimeStatePort,
  type MailSyncRepository,
} from '../src/mail/mail-sync-service.js';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const mailbox: MailboxConfig = {
  mailboxKey: 'mailbox-1',
  providerKey: 'imap',
  maskedAddress: 't***@example.test',
  credentialRef: 'mailbox:1',
  folders: ['INBOX'],
  initialLookbackDays: 30,
  enabled: true,
};

/** 记录同步请求和运行状态，验证游标选择而不依赖具体邮箱协议。 */
class MemoryRuntimeState implements MailRuntimeStatePort {
  public written: MailboxRuntimeState | null = null;

  public constructor(private readonly initial: MailboxRuntimeState | null) {}

  public read(): Promise<MailboxRuntimeState | null> {
    return Promise.resolve(this.initial);
  }

  public write(_mailboxKey: string, value: MailboxRuntimeState): Promise<void> {
    this.written = value;
    return Promise.resolve();
  }
}

/** 空仓储仍保留提交顺序，使测试聚焦游标过期策略。 */
const repository: MailSyncRepository = {
  saveMessageRefs: () => Promise.resolve(),
  enqueueClassification: () => Promise.resolve(),
};

/** 创建只产出一个空页面的连接器，并记录应用层传入的发现请求。 */
function connector(requests: MailChangeRequest[]): MailboxConnector {
  return {
    metadata: {
      providerKey: 'imap',
      version: 'imap-test-v1',
      authKind: 'app_password',
      incrementalMode: 'imap_uid',
      folderMode: 'folders',
      supportsStableMessageId: true,
      supportStatus: 'experimental',
    },
    listFolders: () => Promise.resolve([]),
    async *discoverChanges(_context, request) {
      requests.push(request);
      yield await Promise.resolve({
        messages: [],
        nextCursor: { folders: { INBOX: { lastUid: 20 } } },
        hasMore: false,
      });
    },
    fetchMessage: (): Promise<ExternalMailMessage> => {
      throw new Error('Not used by mail sync tests.');
    },
    healthCheck: () => Promise.resolve({ status: 'healthy', checkedAt: NOW }),
  };
}

/** 构造完整运行状态，确保写回仍满足文件状态 Schema。 */
function runtimeState(lastSuccessAt: number): MailboxRuntimeState {
  return {
    generation: 2,
    connectorVersion: 'imap-test-v1',
    cursor: { folders: { INBOX: { lastUid: 10 } } },
    lastSuccessAt,
    lastFailureAt: NOW - DAY,
    lastErrorCategory: 'network_temporary',
    updatedAt: lastSuccessAt,
  };
}

describe('MailSyncService cursor window', () => {
  it('drops a cursor whose last successful position is older than the lookback window', async () => {
    const requests: MailChangeRequest[] = [];
    const runtime = new MemoryRuntimeState(runtimeState(NOW - 31 * DAY));
    const service = new MailSyncService(repository, runtime, () => NOW);

    await service.sync(mailbox, connector(requests), mailbox.credentialRef);

    expect(requests[0]).toMatchObject({ cursor: null, lookbackDays: 30 });
    expect(runtime.written).toMatchObject({
      generation: 3,
      connectorVersion: 'imap-test-v1',
      lastSuccessAt: NOW,
      lastErrorCategory: null,
      updatedAt: NOW,
    });
  });

  it('continues a cursor whose last successful position remains inside the window', async () => {
    const requests: MailChangeRequest[] = [];
    const current = runtimeState(NOW - 29 * DAY);
    const runtime = new MemoryRuntimeState(current);
    const service = new MailSyncService(repository, runtime, () => NOW);

    await service.sync(mailbox, connector(requests), mailbox.credentialRef);

    expect(requests[0]?.cursor).toEqual(current.cursor);
  });
});
