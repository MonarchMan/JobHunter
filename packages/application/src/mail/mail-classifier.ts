import {
  recruitmentMailClassificationSchema,
  type RecruitmentMailClassification,
} from '@jobhunter/domain';
import type { ExternalMailMessage } from '@jobhunter/mail-core';

/** 版本化的确定性招聘邮件分类器；只处理有界正文，不调用外部模型。 */
export class RecruitmentMailRuleClassifier {
  public readonly version = 'rules-v1';

  /** 1、组合主题和正文；2、按高置信流程词识别；3、输出 Schema 校验后的结果。 */
  public classify(message: ExternalMailMessage): RecruitmentMailClassification {
    const haystack = `${message.subject}\n${message.textBody}`.toLowerCase();
    const eventType = this.#eventType(haystack);
    const recruiting = eventType !== 'not_recruiting';
    const decision =
      recruiting && eventType !== 'other_recruiting'
        ? 'accepted'
        : recruiting
          ? 'needs_review'
          : 'ignored';
    const companyName = extractCompany(message.fromName, message.fromAddress);
    return recruitmentMailClassificationSchema.parse({
      eventType,
      decision,
      companyName,
      roleTitle: null,
      applicationKey: null,
      effectiveAt: message.receivedAt,
      deadlineAt: null,
      interviewAt: null,
      timezoneText: null,
      location: null,
      meetingUrl: firstHttpsUrl(message.textBody),
      actionUrl: firstHttpsUrl(message.textBody),
      recruiterName: message.fromName || null,
      confidence: decision === 'accepted' ? 0.88 : decision === 'ignored' ? 0.99 : 0.4,
      evidence: [message.subject.slice(0, 500)],
      classifierKind: 'rules',
      classifierVersion: this.version,
    });
  }

  #eventType(value: string): RecruitmentMailClassification['eventType'] {
    if (/offer|录用|意向书|薪资确认/.test(value))
      return /正式|正式录用|congratulations/.test(value) ? 'offer_issued' : 'offer_intent';
    if (/拒绝|遗憾|不再继续|rejected|regret/.test(value)) return 'rejected';
    if (/流程结束|职位关闭|process.*closed|application.*closed/.test(value))
      return 'process_closed';
    if (/面试|interview/.test(value))
      return /改期|reschedul|change.*time/.test(value)
        ? 'interview_rescheduled'
        : /取消|cancel/.test(value)
          ? 'interview_cancelled'
          : 'interview_invited';
    if (/笔试|测评|assessment|online test|coding test/.test(value)) return 'assessment_invited';
    if (/申请已收到|申请确认|application received|thank.*apply/.test(value))
      return 'application_acknowledged';
    if (/招聘|candidate|应聘|职位|recruit/.test(value)) return 'other_recruiting';
    return 'not_recruiting';
  }
}

function extractCompany(name: string, address: string): string | null {
  const value = name.trim() || address.split('@')[1]?.trim() || '';
  return value.length > 0 ? value.slice(0, 320) : null;
}

function firstHttpsUrl(value: string): string | null {
  const match = value.match(/https:\/\/[^\s<>"']+/i)?.[0];
  return match ? match.replace(/[),.;]+$/, '') : null;
}
