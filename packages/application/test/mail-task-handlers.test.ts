import {
  contentHash,
  parseId,
  utcInstant,
  type RecruitmentMailClassification,
} from '@jobhunter/domain';
import type { ExternalMailMessage, MailboxConfig, MailboxConnector } from '@jobhunter/mail-core';
import { describe, expect, it } from 'vitest';
import {
  createMailClassifyTaskHandler,
  type RecruitmentMailClassificationPort,
  type RecruitmentMailMessageRef,
  type RecruitmentMailProcessingRepository,
} from '../src/mail/mail-task-handlers.js';
import type { RecruitmentMailClassificationResult } from '../src/mail/mail-classifier.js';
import type { TaskHandlerContext } from '../src/tasks/model.js';

const mailbox: MailboxConfig = {
  mailboxKey: 'mailbox-1',
  providerKey: 'imap',
  maskedAddress: 't***@example.test',
  credentialRef: 'mailbox:1',
  folders: ['INBOX'],
  initialLookbackDays: 30,
  enabled: true,
};

const message: ExternalMailMessage = {
  mailboxKey: mailbox.mailboxKey,
  providerKey: 'imap',
  externalMessageKey: 'INBOX:1:2',
  folderId: 'INBOX',
  threadKey: null,
  receivedAt: 1_760_000_000_000,
  contentVersion: '1:2',
  sourceUrl: null,
  changeKind: 'added',
  subject: '示例科技面试邀请',
  fromName: '招聘团队',
  fromAddress: 'recruit@example.test',
  textBody: '请参加后端工程师岗位面试，申请编号 APP-100。',
  htmlBody: null,
  headers: {},
};

/** 构造任务上下文，确保测试覆盖 Worker 的取消信号和提交时间。 */
function context(controller = new AbortController()): TaskHandlerContext {
  return {
    taskId: parseId('018f0000-0000-7000-8000-000000000201', 'Task'),
    signal: controller.signal,
    clock: { now: () => utcInstant(1_760_000_100_000) },
    logger: {
      info(event, fields) {
        void event;
        void fields;
      },
      warn(event, fields) {
        void event;
        void fields;
      },
      error(event, fields) {
        void event;
        void fields;
      },
    },
    services: {},
  };
}

/** 创建已通过边界校验的分类结果，按测试需要覆盖关键字段。 */
function classification(
  overrides: Partial<RecruitmentMailClassification> = {},
): RecruitmentMailClassificationResult {
  const value: RecruitmentMailClassification = {
    eventType: 'interview_invited',
    decision: 'accepted',
    companyName: '示例科技',
    roleTitle: '后端工程师',
    applicationKey: 'APP-100',
    effectiveAt: message.receivedAt,
    schedule: {
      activityType: 'interview',
      scheduledStartAt: 1_760_100_000_000,
      scheduledEndAt: null,
      deadlineAt: null,
      scheduledStartLocalDate: null,
      scheduledEndLocalDate: null,
      deadlineLocalDate: null,
      previousScheduledStartAt: null,
      previousScheduledStartLocalDate: null,
      timePrecision: 'exact_time',
      timezoneSource: 'explicit',
      timezoneText: '北京时间',
      stageLabel: '技术一面',
    },
    location: null,
    meetingUrl: null,
    actionUrl: null,
    recruiterName: null,
    confidence: 0.96,
    evidence: ['示例科技面试邀请'],
    classifierKind: 'agent',
    classifierVersion: 'v1',
    ...overrides,
  };
  return {
    classification: value,
    candidate: {
      candidate: value.eventType !== 'not_recruiting',
      confidence: value.eventType === 'not_recruiting' ? 'excluded' : 'strong',
      reasonCodes: ['test'],
      policyVersion: 'candidate-rules-v4',
    },
    agentRunId: value.classifierKind === 'agent' ? 'agent-run-1' : null,
    modelStatus: value.classifierKind === 'agent' ? 'succeeded' : 'not_needed',
  };
}

/** 记录分类任务的持久化副作用，不模拟数据库实现细节。 */
class RecordingRepository implements RecruitmentMailProcessingRepository {
  public readonly updates: Parameters<
    RecruitmentMailProcessingRepository['updateMessageStatus']
  >[0][] = [];
  public readonly events: Parameters<
    RecruitmentMailProcessingRepository['appendAcceptedApplicationEvent']
  >[0][] = [];

  public findMessageRef(id: string): RecruitmentMailMessageRef | null {
    return id === 'message-ref-1' ? { ...message, id } : null;
  }

  public updateMessageStatus(
    input: Parameters<RecruitmentMailProcessingRepository['updateMessageStatus']>[0],
  ): void {
    this.updates.push(input);
  }

  public appendAcceptedApplicationEvent(
    input: Parameters<RecruitmentMailProcessingRepository['appendAcceptedApplicationEvent']>[0],
  ): boolean {
    this.events.push(input);
    return true;
  }
}

/** 创建只返回正文的连接器；发现和健康检查不属于本处理器测试范围。 */
function connector(): MailboxConnector {
  return {
    metadata: {
      providerKey: 'imap',
      version: 'test-v1',
      authKind: 'app_password',
      incrementalMode: 'imap_uid',
      folderMode: 'folders',
      supportsStableMessageId: true,
      supportStatus: 'experimental',
    },
    listFolders: () => Promise.resolve([]),
    discoverChanges: () => {
      throw new Error('Not used by classification tests.');
    },
    fetchMessage: () => Promise.resolve(message),
    healthCheck: () => Promise.resolve({ status: 'healthy', checkedAt: 0 }),
  };
}

/** 使用固定分类端口运行单邮件处理器，便于验证事件提交门槛。 */
async function execute(result: RecruitmentMailClassificationResult): Promise<{
  output: { status: 'accepted' | 'needs_review' | 'ignored' };
  repository: RecordingRepository;
}> {
  const repository = new RecordingRepository();
  const classifier: RecruitmentMailClassificationPort = { classify: () => Promise.resolve(result) };
  const handler = createMailClassifyTaskHandler({
    configs: { list: () => Promise.resolve([mailbox]) },
    connectorFor: () => connector(),
    classifier,
    repository,
    createId: () => 'event-1',
  });
  const output = await handler.execute(context(), { messageRefId: 'message-ref-1' });
  return { output, repository };
}

describe('mail classification task handler', () => {
  it('persists an accepted event only when application identity is complete', async () => {
    const { output, repository } = await execute(classification());

    expect(output).toEqual({ status: 'accepted' });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      companyName: '示例科技',
      roleTitle: '后端工程师',
      mailMessageRefId: 'message-ref-1',
      agentRunId: 'agent-run-1',
      eventType: 'interview_invited',
    });
    expect(repository.events[0]?.externalApplicationKeyHash).toBe(
      contentHash({ mailboxKey: mailbox.mailboxKey, applicationKey: 'APP-100' }),
    );
    expect(JSON.parse(repository.events[0]?.payloadJson ?? '{}')).toMatchObject({
      schedule: {
        activityType: 'interview',
        scheduledStartAt: 1_760_100_000_000,
        timePrecision: 'exact_time',
      },
    });
    expect(repository.updates[0]?.status).toBe('accepted');
  });

  it('derives a stable application identity for an accepted schedule without an external key', async () => {
    const { output, repository } = await execute(classification({ applicationKey: null }));

    expect(output).toEqual({ status: 'accepted' });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      externalApplicationKeyHash: null,
      companyName: '示例科技',
      roleTitle: '后端工程师',
    });
    expect(repository.events[0]?.applicationId).toBe(
      `mail-app-${contentHash({
        mailboxKey: mailbox.mailboxKey,
        identityKind: 'schedule_company_role',
        companyName: '示例科技',
        roleTitle: '后端工程师',
      }).slice(0, 40)}`,
    );
    expect(repository.updates[0]?.status).toBe('accepted');
  });

  it('keeps an explicit schedule when its mail template omits the role title', async () => {
    const { output, repository } = await execute(
      classification({ applicationKey: null, roleTitle: null }),
    );

    expect(output).toEqual({ status: 'accepted' });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      companyName: '示例科技',
      roleTitle: '未知',
      externalApplicationKeyHash: null,
    });
    expect(repository.events[0]?.applicationId).toBe(
      `mail-app-${contentHash({
        mailboxKey: mailbox.mailboxKey,
        identityKind: 'schedule_message',
        messageRefId: 'message-ref-1',
      }).slice(0, 40)}`,
    );
  });

  it('keeps a non-schedule result without an external application key for review', async () => {
    const { output, repository } = await execute(
      classification({ applicationKey: null, schedule: null }),
    );

    expect(output).toEqual({ status: 'needs_review' });
    expect(repository.events).toEqual([]);
    expect(repository.updates[0]?.status).toBe('needs_review');
  });

  it('records a stable negative without creating an application event', async () => {
    const { output, repository } = await execute(
      classification({
        eventType: 'not_recruiting',
        decision: 'ignored',
        companyName: null,
        roleTitle: null,
        applicationKey: null,
        confidence: 0.95,
        classifierKind: 'rules',
        classifierVersion: 'candidate-rules-v4',
      }),
    );

    expect(output).toEqual({ status: 'ignored' });
    expect(repository.events).toEqual([]);
    expect(repository.updates[0]).toMatchObject({
      status: 'ignored',
      classifierKind: 'rules',
      classifierVersion: 'candidate-rules-v4',
    });
  });

  it('maps an aborted classification to a cancelled task', async () => {
    const controller = new AbortController();
    const repository = new RecordingRepository();
    const handler = createMailClassifyTaskHandler({
      configs: { list: () => Promise.resolve([mailbox]) },
      connectorFor: () => connector(),
      classifier: {
        classify: () => {
          controller.abort();
          return Promise.reject(new Error('sensitive provider error'));
        },
      },
      repository,
      createId: () => 'event-1',
    });

    await expect(
      handler.execute(context(controller), { messageRefId: 'message-ref-1' }),
    ).rejects.toMatchObject({ category: 'cancelled', message: 'Mailbox task was cancelled.' });
    expect(repository.updates).toEqual([]);
  });
});
