import { recruitmentMailClassificationSchema, projectApplicationStatus } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import { RecruitmentMailRuleClassifier } from '../src/mail/mail-classifier.js';

describe('recruitment mail rules', () => {
  it('recognizes interview invitations and keeps output schema-valid', () => {
    const result = new RecruitmentMailRuleClassifier().classify({
      mailboxKey: 'test',
      providerKey: 'imap',
      externalMessageKey: 'INBOX:1:10',
      folderId: 'INBOX',
      threadKey: null,
      receivedAt: 1_700_000_000_000,
      contentVersion: '1:10',
      sourceUrl: null,
      changeKind: 'added',
      subject: '面试邀请',
      fromName: '招聘团队',
      fromAddress: 'hr@example.com',
      textBody: '请参加下一轮面试。',
      htmlBody: null,
      calendarBody: null,
      headers: {},
    });
    expect(recruitmentMailClassificationSchema.safeParse(result).success).toBe(true);
    expect(result.eventType).toBe('interview_invited');
    expect(projectApplicationStatus(result.eventType)).toBe('interview');
  });

  it('does not treat marketing mail as a recruiting event', () => {
    const result = new RecruitmentMailRuleClassifier().classify({
      mailboxKey: 'test',
      providerKey: 'gmail',
      externalMessageKey: 'm-1',
      folderId: 'INBOX',
      threadKey: null,
      receivedAt: 1_700_000_000_000,
      contentVersion: 'v1',
      sourceUrl: null,
      changeKind: 'added',
      subject: '本周优惠活动',
      fromName: 'Newsletter',
      fromAddress: 'news@example.com',
      textBody: '限时优惠',
      htmlBody: null,
      calendarBody: null,
      headers: {},
    });
    expect(result.decision).toBe('ignored');
    expect(result.eventType).toBe('not_recruiting');
  });
});
