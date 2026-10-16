import {
  AgentRunner,
  type AgentRunRecord,
  type AgentRunStore,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ToolCallRecord,
} from '@jobhunter/agent-core';
import { recruitmentMailClassificationSchema } from '@jobhunter/domain';
import type { ExternalMailMessage } from '@jobhunter/mail-core';
import { describe, expect, it } from 'vitest';
import { RecruitmentMailCandidateScreener } from '../src/mail/mail-candidate-screener.js';
import { RecruitmentMailClassifier } from '../src/mail/mail-classifier.js';
import { prepareRecruitmentMail } from '../src/mail/mail-content.js';

/** 保存测试 Agent 运行记录，模拟生产数据库端口。 */
class MemoryAgentRunStore implements AgentRunStore {
  public readonly runs = new Map<string, AgentRunRecord>();
  public readonly toolCalls: ToolCallRecord[] = [];

  public get(id: string): AgentRunRecord | null {
    return this.runs.get(id) ?? null;
  }

  public findSucceeded(cacheKey: string): AgentRunRecord | null {
    return (
      [...this.runs.values()].find(
        (record) => record.cacheKey === cacheKey && record.status === 'succeeded',
      ) ?? null
    );
  }

  public invalidateSucceeded(id: string): void {
    const record = this.required(id);
    this.runs.set(id, { ...record, status: 'failed', errorCategory: 'invalid_output' });
  }

  public createRunning(record: AgentRunRecord): void {
    this.runs.set(record.id, record);
  }

  public completeSucceeded(
    input: Parameters<AgentRunStore['completeSucceeded']>[0],
  ): ReturnType<AgentRunStore['completeSucceeded']> {
    const record: AgentRunRecord = {
      ...this.required(input.id),
      status: 'succeeded',
      output: input.output,
      outputHash: input.outputHash,
      errorCategory: null,
      errorSummary: null,
      ...input.usage,
      finishedAt: input.finishedAt,
    };
    this.runs.set(record.id, record);
    return { kind: 'stored', record };
  }

  public completeFailed(input: Parameters<AgentRunStore['completeFailed']>[0]): AgentRunRecord {
    const record: AgentRunRecord = {
      ...this.required(input.id),
      status: input.status,
      errorCategory: input.category,
      errorSummary: input.summary,
      ...input.usage,
      finishedAt: input.finishedAt,
    };
    this.runs.set(record.id, record);
    return record;
  }

  public saveToolCall(record: ToolCallRecord): void {
    this.toolCalls.push(record);
  }

  /** 返回已登记记录，避免测试替身掩盖运行时生命周期错误。 */
  private required(id: string): AgentRunRecord {
    const record = this.runs.get(id);
    if (!record) throw new TypeError('Agent run not found.');
    return record;
  }
}

/** 返回固定结构化结果并记录请求，便于验证模型边界。 */
class RecordingModel implements ModelClient {
  public readonly metadata = {
    provider: 'test',
    model: 'mail-test',
    config: {},
    costCurrency: 'USD',
    pricingVersion: 'test-v1',
  };
  public readonly requests: ModelRequest[] = [];
  public outputOverrides: Readonly<Record<string, unknown>> = {};

  public complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return Promise.resolve({
      kind: 'output',
      output: {
        eventType: 'interview_invited',
        decision: 'accepted',
        companyName: '示例科技',
        roleTitle: '后端工程师',
        applicationKey: null,
        effectiveAt: '2026-10-15T02:00:00+00:00',
        schedule: {
          activityType: 'interview',
          scheduledStartAt: '2026-10-16T14:00:00+08:00',
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
        location: '线上',
        meetingUrl: 'https://meet.example.test/interview',
        actionUrl: null,
        recruiterName: null,
        confidence: 0.96,
        evidence: ['示例科技面试邀请', 'https://meet.example.test/interview'],
        ...this.outputOverrides,
      },
      usage: { inputTokens: 100, outputTokens: 80, estimatedCostMicros: 10 },
    });
  }
}

/** 构造不含真实个人信息的邮件测试样本。 */
function mail(overrides: Partial<ExternalMailMessage> = {}): ExternalMailMessage {
  return {
    mailboxKey: 'test-mailbox',
    providerKey: 'imap',
    externalMessageKey: 'INBOX:1:10',
    folderId: 'INBOX',
    threadKey: null,
    receivedAt: 1_760_000_000_000,
    contentVersion: '1:10',
    sourceUrl: null,
    changeKind: 'added',
    subject: '示例科技面试邀请',
    fromName: '招聘团队',
    fromAddress: 'recruit@example.test',
    textBody: '',
    htmlBody: null,
    headers: {},
    ...overrides,
  };
}

/** 构造模型侧日程输出，允许单项覆盖以验证跨字段业务约束。 */
function agentSchedule(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    activityType: 'interview',
    scheduledStartAt: '2026-10-16T14:00:00+08:00',
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
    stageLabel: null,
    ...overrides,
  };
}

describe('recruitment mail classification', () => {
  it.each([
    '申请已收到',
    '感谢申请，您的投递成功',
    'Your application has been received',
    'Thank you for applying',
    '笔试邀请',
    '邀请您完成在线测评',
    'Invitation to coding test',
    'Assessment deadline reminder',
    '面试安排通知',
    '邀请您参加面试',
    'Invitation to interview',
    'Interview scheduled',
    '面试时间调整，请以此为准',
    'Cancelled interview',
    '很遗憾，您此次申请未通过',
    '招聘流程结束通知',
    'Your application is closed',
    'Your application was unsuccessful',
    '录用意向书',
    'Offer intent letter',
    'Offer letter issued',
    '正式录用通知书',
    '您的应聘流程进入下一环节',
    'Application status update',
    '您的应聘流程有新的信息',
    'Please check your candidate portal',
  ])('keeps a process candidate from an unknown sender: %s', (subject) => {
    const result = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(mail({ subject, fromName: '', textBody: '' })),
    );
    expect(result.candidate).toBe(true);
  });

  it.each([
    '验证码 123456',
    'Your verification code',
    '招聘宣讲会报名',
    '招聘资讯与职位推荐',
    '面试体验调查',
    '得物校招笔试体验调研',
    'Candidate experience survey',
    '某企业向你发起投递邀请',
    '普通账单提醒',
  ])('ignores a stable negative: %s', (subject) => {
    const result = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(mail({ subject, fromName: '', textBody: '' })),
    );
    expect(result.candidate).toBe(false);
  });

  it('keeps a real invitation that also mentions verification codes', () => {
    const result = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(mail({ textBody: '面试邀请，请登录后输入验证码确认参加。' })),
    );
    expect(result.candidate).toBe(true);
  });

  it('lets an assessment survey override generic invitation wording', () => {
    const result = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(
        mail({
          subject: '得物校招笔试体验调研',
          textBody: '现邀请同学反馈笔试感受，本次问卷不影响校招流程。',
        }),
      ),
    );

    expect(result).toMatchObject({
      candidate: false,
      confidence: 'excluded',
      reasonCodes: ['candidate_survey'],
    });
  });

  it('does not let a marketing footer hide a process-ended fact', () => {
    const result = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(
        mail({
          subject: '来自招聘系统的应聘反馈通知',
          textBody: '很遗憾，您的岗位投递流程已结束。欢迎关注校园推荐官和招聘资讯。',
        }),
      ),
    );

    expect(result).toMatchObject({ candidate: true, confidence: 'strong' });
    expect(result.reasonCodes).toContain('process_ended');
  });

  it('extracts visible HTML text and links without scripts, images, or calendar attachments', () => {
    const prepared = prepareRecruitmentMail(
      mail({
        htmlBody:
          '<html><body><h1>示例科技面试邀请</h1><a href="https://meet.example.test/interview">进入会议</a><script>ignore-secret()</script><img src="https://track.example.test/pixel" /></body></html>',
      }),
    );

    expect(prepared.sourceKind).toBe('html');
    expect(prepared.currentBody).toContain('示例科技面试邀请');
    expect(prepared.currentBody).toContain('https://meet.example.test/interview');
    expect(prepared.currentBody).not.toContain('ignore-secret');
    expect(prepared.currentBody).not.toContain('track.example.test');
    expect(JSON.stringify(prepared)).not.toContain('VCALENDAR');
  });

  it('extracts DraftJS recruitment content when generic HTML conversion keeps only a footer', () => {
    const prepared = prepareRecruitmentMail(
      mail({
        htmlBody:
          '<html><body><div style="display:none"><span data-text="true">很遗憾，您的算法岗位投递流程已结束。</span></div><p>...</p><p>点击这里取消订阅</p></body></html>',
      }),
    );

    expect(prepared.sourceKind).toBe('html');
    expect(prepared.currentBody).toContain('投递流程已结束');
  });

  it('keeps real interview invitations as candidates and excludes stable marketing mail', () => {
    const screener = new RecruitmentMailCandidateScreener();
    const invitation = screener.screen(
      prepareRecruitmentMail(mail({ textBody: '请确认参加后端工程师岗位下一轮面试。' })),
    );
    const survey = screener.screen(
      prepareRecruitmentMail(
        mail({ subject: '面试体验调查', textBody: '请填写候选人满意度评价邀请。' }),
      ),
    );
    const eventMarketing = screener.screen(
      prepareRecruitmentMail(
        mail({ subject: '校园招聘宣讲会', textBody: '热门岗位推荐，欢迎报名宣讲活动。' }),
      ),
    );

    expect(invitation).toMatchObject({ candidate: true, confidence: 'strong' });
    expect(survey).toMatchObject({ candidate: false, confidence: 'excluded' });
    expect(eventMarketing).toMatchObject({ candidate: false, confidence: 'excluded' });
  });

  it('conservatively keeps an unknown template from a known recruiting sender', () => {
    const decision = new RecruitmentMailCandidateScreener().screen(
      prepareRecruitmentMail(
        mail({
          subject: '关于您的候选流程',
          fromAddress: 'notice@hire.feishu.example',
          textBody: '您的候选人流程有新的信息，请留意后续安排。',
        }),
      ),
    );

    expect(decision).toMatchObject({ candidate: true, confidence: 'possible' });
    expect(decision.reasonCodes).toContain('known_recruiting_sender_unknown_template');
  });

  it('uses an agent for candidates without persisting extracted mail fields', async () => {
    const store = new MemoryAgentRunStore();
    const model = new RecordingModel();
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({ store, model, createId: () => 'mail-run-1', now: () => 100 }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        textBody:
          '示例科技面试邀请。面试时间为北京时间 2026 年 10 月 16 日 14:00，地点线上：https://meet.example.test/interview',
      }),
      new AbortController().signal,
    );

    expect(recruitmentMailClassificationSchema.safeParse(result.classification).success).toBe(true);
    expect(result).toMatchObject({ modelStatus: 'succeeded', agentRunId: 'mail-run-1' });
    expect(result.classification.eventType).toBe('interview_invited');
    expect(result.classification.schedule).toMatchObject({
      activityType: 'interview',
      scheduledStartAt: Date.parse('2026-10-16T14:00:00+08:00'),
      timePrecision: 'exact_time',
      timezoneSource: 'explicit',
      stageLabel: '技术一面',
    });
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.tools).toEqual([]);
    expect(JSON.stringify(model.requests[0]?.input)).not.toContain('VCALENDAR');
    const stored = store.get('mail-run-1');
    expect(stored?.output).toBeNull();
    expect(stored?.outputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain('示例科技');
    expect(store.toolCalls).toEqual([]);
  });

  it('keeps date-only assessment deadlines without inventing a midnight instant', async () => {
    const model = new RecordingModel();
    model.outputOverrides = {
      eventType: 'assessment_invited',
      meetingUrl: null,
      schedule: {
        activityType: 'assessment',
        scheduledStartAt: null,
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: null,
        scheduledEndLocalDate: null,
        deadlineLocalDate: '2026-10-22',
        previousScheduledStartAt: null,
        previousScheduledStartLocalDate: null,
        timePrecision: 'date_only',
        timezoneSource: 'not_applicable',
        timezoneText: null,
        stageLabel: '在线测评',
      },
      evidence: ['请在 2026 年 10 月 22 日前完成在线测评'],
    };
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({
        store: new MemoryAgentRunStore(),
        model,
        createId: () => 'date-only-run',
        now: () => 100,
      }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        subject: '在线测评邀请',
        textBody: '请在 2026 年 10 月 22 日前完成在线测评',
      }),
      new AbortController().signal,
    );

    expect(result.classification.schedule).toMatchObject({
      activityType: 'assessment',
      deadlineAt: null,
      deadlineLocalDate: '2026-10-22',
      timePrecision: 'date_only',
      timezoneSource: 'not_applicable',
    });
  });

  it('extracts the new and previous time for a rescheduled interview', async () => {
    const model = new RecordingModel();
    model.outputOverrides = {
      eventType: 'interview_rescheduled',
      meetingUrl: null,
      schedule: {
        activityType: 'interview',
        scheduledStartAt: '2026-10-21T15:00:00+08:00',
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: null,
        scheduledEndLocalDate: null,
        deadlineLocalDate: null,
        previousScheduledStartAt: '2026-10-20T14:00:00+08:00',
        previousScheduledStartLocalDate: null,
        timePrecision: 'exact_time',
        timezoneSource: 'explicit',
        timezoneText: '北京时间',
        stageLabel: '技术一面',
      },
      evidence: ['原定 10 月 20 日 14:00，调整至 10 月 21 日 15:00'],
    };
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({
        store: new MemoryAgentRunStore(),
        model,
        createId: () => 'reschedule-run',
        now: () => 100,
      }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        subject: '面试时间调整',
        textBody: '北京时间，原定 10 月 20 日 14:00，调整至 10 月 21 日 15:00。',
      }),
      new AbortController().signal,
    );

    expect(result.classification.schedule).toMatchObject({
      scheduledStartAt: Date.parse('2026-10-21T15:00:00+08:00'),
      previousScheduledStartAt: Date.parse('2026-10-20T14:00:00+08:00'),
    });
  });

  it('keeps an assessment date range as local dates', async () => {
    const model = new RecordingModel();
    model.outputOverrides = {
      eventType: 'assessment_invited',
      meetingUrl: null,
      schedule: {
        activityType: 'written_exam',
        scheduledStartAt: null,
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: '2026-10-18',
        scheduledEndLocalDate: '2026-10-20',
        deadlineLocalDate: null,
        previousScheduledStartAt: null,
        previousScheduledStartLocalDate: null,
        timePrecision: 'date_range',
        timezoneSource: 'not_applicable',
        timezoneText: null,
        stageLabel: '在线笔试',
      },
      evidence: ['笔试开放时间为 2026 年 10 月 18 日至 20 日'],
    };
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({
        store: new MemoryAgentRunStore(),
        model,
        createId: () => 'date-range-run',
        now: () => 100,
      }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        subject: '在线笔试邀请',
        textBody: '笔试开放时间为 2026 年 10 月 18 日至 20 日',
      }),
      new AbortController().signal,
    );

    expect(result.classification.schedule).toMatchObject({
      activityType: 'written_exam',
      scheduledStartLocalDate: '2026-10-18',
      scheduledEndLocalDate: '2026-10-20',
      timePrecision: 'date_range',
    });
  });

  it('records only the target time for a cancelled interview', async () => {
    const model = new RecordingModel();
    model.outputOverrides = {
      eventType: 'interview_cancelled',
      meetingUrl: null,
      schedule: {
        activityType: 'interview',
        scheduledStartAt: null,
        scheduledEndAt: null,
        deadlineAt: null,
        scheduledStartLocalDate: null,
        scheduledEndLocalDate: null,
        deadlineLocalDate: null,
        previousScheduledStartAt: '2026-10-20T14:00:00+08:00',
        previousScheduledStartLocalDate: null,
        timePrecision: 'exact_time',
        timezoneSource: 'explicit',
        timezoneText: '北京时间',
        stageLabel: '技术一面',
      },
      evidence: ['原定 2026 年 10 月 20 日 14:00 的技术一面已取消'],
    };
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({
        store: new MemoryAgentRunStore(),
        model,
        createId: () => 'cancellation-run',
        now: () => 100,
      }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        subject: '面试取消通知',
        textBody: '北京时间，原定 2026 年 10 月 20 日 14:00 的技术一面已取消。',
      }),
      new AbortController().signal,
    );

    expect(result.classification.schedule).toMatchObject({
      scheduledStartAt: null,
      previousScheduledStartAt: Date.parse('2026-10-20T14:00:00+08:00'),
    });
  });

  it('keeps a candidate for review when the model is unavailable', async () => {
    const result = await new RecruitmentMailClassifier({
      defaultTimezone: 'Asia/Shanghai',
    }).classify(
      mail({ textBody: '请确认参加后端工程师岗位下一轮面试。' }),
      new AbortController().signal,
    );

    expect(result.modelStatus).toBe('unavailable');
    expect(result.classification).toMatchObject({
      eventType: 'other_recruiting',
      decision: 'needs_review',
    });
  });

  it('does not call the model for a stable non-recruiting mail', async () => {
    const store = new MemoryAgentRunStore();
    const model = new RecordingModel();
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({ store, model, createId: () => 'unused-run', now: () => 100 }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({
        subject: '面试体验调查',
        textBody: '请填写候选人满意度评价邀请。',
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      modelStatus: 'not_needed',
      agentRunId: null,
      candidate: { candidate: false, confidence: 'excluded' },
      classification: { eventType: 'not_recruiting', decision: 'ignored' },
    });
    expect(model.requests).toEqual([]);
    expect(store.runs.size).toBe(0);
  });

  it.each([
    { eventType: 'unknown' },
    { confidence: 1.5 },
    { evidence: ['邮件中不存在的证据'] },
    { meetingUrl: 'https://invented.example.test/meeting' },
    { meetingUrl: 'http://meet.example.test/interview' },
    {
      eventType: 'assessment_invited',
      schedule: agentSchedule({ activityType: 'coding_test' }),
    },
    {
      schedule: agentSchedule({ scheduledStartAt: 'not-a-date' }),
    },
    {
      schedule: agentSchedule({
        scheduledStartAt: null,
        timePrecision: 'exact_time',
        timezoneSource: 'unknown',
      }),
    },
    {
      schedule: agentSchedule({
        scheduledStartLocalDate: '2026-10-16',
        timePrecision: 'date_only',
      }),
    },
    {
      schedule: agentSchedule({
        scheduledEndAt: '2026-10-16T15:00:00+08:00',
        scheduledStartLocalDate: '2026-10-16',
        timePrecision: 'time_range',
      }),
    },
    {
      schedule: agentSchedule({
        scheduledStartLocalDate: '2026-10-16',
        scheduledEndLocalDate: '2026-10-17',
        timePrecision: 'date_range',
      }),
    },
    { eventType: 'offer_issued' },
    { eventType: 'not_recruiting', decision: 'accepted' },
  ])('rejects invalid facts after one repair without persisting them: %j', async (overrides) => {
    const store = new MemoryAgentRunStore();
    const model = new RecordingModel();
    model.outputOverrides = overrides;
    const classifier = new RecruitmentMailClassifier({
      runner: new AgentRunner({ store, model, createId: () => 'invalid-mail-run', now: () => 100 }),
      defaultTimezone: 'Asia/Shanghai',
    });

    const result = await classifier.classify(
      mail({ textBody: '示例科技面试邀请：https://meet.example.test/interview' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      modelStatus: 'unavailable',
      classification: { decision: 'needs_review' },
    });
    expect(model.requests).toHaveLength(2);
    const stored = store.get('invalid-mail-run');
    expect(stored?.status).toBe('failed');
    expect(stored?.output).toBeNull();
    expect(JSON.stringify(stored)).not.toContain('示例科技');
    expect(JSON.stringify(stored)).not.toContain('invented.example.test');
  });

  it('separates bounded quoted history from the current message', () => {
    const prepared = prepareRecruitmentMail(
      mail({
        textBody: `面试已取消，请留意后续通知。\n-----Original Message-----\n${'旧面试邀请'.repeat(2_000)}`,
      }),
    );

    expect(prepared.currentBody).toBe('面试已取消,请留意后续通知。');
    expect(prepared.quotedHistory?.length).toBeLessThanOrEqual(4_000);
    expect(prepared.wasTruncated).toBe(true);
  });
});
