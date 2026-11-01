import { z } from 'zod';
import type { PreparedRecruitmentMail } from './mail-content.js';

/** 候选规则只决定是否调用模型，不直接生成申请事件。 */
export const recruitmentMailCandidateDecisionSchema = z
  .object({
    candidate: z.boolean(),
    confidence: z.enum(['strong', 'possible', 'excluded']),
    reasonCodes: z.array(z.string().min(1).max(80)).min(1).max(12),
    policyVersion: z.string().min(1),
  })
  .strict();

export type RecruitmentMailCandidateDecision = z.infer<
  typeof recruitmentMailCandidateDecisionSchema
>;

/** 带稳定原因码的规则；权重只辅助候选召回，不决定最终业务事件。 */
interface CandidateRule {
  readonly code: string;
  readonly pattern: RegExp;
  readonly weight: number;
}

const strongEventRules: readonly CandidateRule[] = [
  {
    code: 'application_acknowledged',
    pattern:
      /投递成功|申请(?:已收到|确认)|收到.{0,12}(?:投递|申请)|application (?:was |has been )?received|thank.{0,20}(?:apply|applying|application)/iu,
    weight: 4,
  },
  {
    code: 'assessment',
    pattern:
      /(?:在线|人才|技术|综合)?(?:测评|笔试).{0,16}(?:邀请|通知|提醒|截止|到期)|邀请.{0,20}(?:测评|笔试)|(?:assessment|coding test|online test).{0,24}(?:invite|invitation|deadline|reminder)|(?:invite|invitation).{0,30}(?:assessment|coding test|online test)/iu,
    weight: 4,
  },
  {
    code: 'interview',
    pattern:
      /面试(?:邀请函|邀请|邀约|安排|通知|时间|提醒)|邀请.{0,20}(?:参加.{0,8})?面试|interview.{0,20}(?:invite|invitation|schedul|reschedul|reminder)|(?:invite|invitation|schedul).{0,30}interview/iu,
    weight: 4,
  },
  {
    code: 'interview_changed',
    pattern:
      /面试.{0,20}(?:调整|更改|更正|改期|取消|请以此为准)|(?:reschedul|cancel).{0,20}interview/iu,
    weight: 5,
  },
  {
    code: 'process_ended',
    pattern:
      /(?:遗憾|很抱歉|不得不).{0,80}(?:申请|投递|岗位|流程)|(?:投递|申请|应聘|招聘).{0,40}(?:流程已结束|流程结束|未通过|不匹配)|(?:面试|笔试|测评).{0,20}未通过|(?:regret|unfortunately).{0,80}(?:application|position|candidate)|(?:application|recruitment process).{0,30}(?:closed|ended|unsuccessful|not.{0,10}selected)/iu,
    weight: 5,
  },
  {
    code: 'offer',
    pattern:
      /录用(?:通知书|意向)|正式录用|入职安排|意向书|薪资确认|接受.{0,12}录用|\boffer\b.{0,30}(?:letter|issued|accept|intent|入职|录用|意向)/iu,
    weight: 5,
  },
  {
    code: 'process_updated',
    pattern:
      /(?:应聘|申请|招聘|候选人).{0,20}(?:进度更新|流程更新|进入下一|下一环节)|(?:application|recruitment).{0,20}(?:status update|next stage|next step)/iu,
    weight: 3,
  },
];

const supportingRules: readonly CandidateRule[] = [
  {
    code: 'role_context',
    pattern:
      /应聘(?:职位|岗位)?|申请(?:职位|岗位)|面试岗位|应聘职位|position applied|applied (?:for|to)/iu,
    weight: 1,
  },
  {
    code: 'action_context',
    pattern: /请.{0,20}(?:确认|参加|完成|回复|预约)|截止时间|有效期|招聘流程|候选人|candidate/iu,
    weight: 1,
  },
  {
    code: 'ats_domain',
    pattern: /(?:mokahr|hire\.feishu|alibaba-inc|bytedance|tencent|huawei|talent|recruit|career)/iu,
    weight: 1,
  },
];

const recognizedRecruitingDomains =
  /(?:mokahr|hire\.feishu|alibaba-inc|bytedance|tencent|huawei|talent|recruit|career)/iu;

const broadRecruitingContext =
  /招聘|应聘|求职|候选人|岗位|职位|流程|面试|笔试|测评|录用|offer|application|applicant|candidate|position|interview|assessment|recruit/iu;

const stableNegativeRules: readonly CandidateRule[] = [
  {
    code: 'candidate_survey',
    pattern:
      /(?:面试|笔试|测评)(?:满意度|体验)(?:评价|调查|调研|问卷)|(?:面试|笔试|测评)反馈问卷|满意度评价邀请|candidate experience survey/iu,
    weight: 0,
  },
  {
    code: 'job_invitation_marketing',
    pattern: /投递邀请|邀请投递|职位发起邀请|岗位发起邀请/iu,
    weight: 0,
  },
  {
    code: 'recruitment_event_marketing',
    pattern:
      /招聘宣讲会|校园推荐官|社团招新|面试直通车|招聘热招中|岗位推荐|职位推荐|招聘资讯|人才推荐奖励/iu,
    weight: 0,
  },
  {
    code: 'verification_code',
    pattern: /验证码|verification code|one[- ]time (?:code|password)|\botp\b/iu,
    weight: 0,
  },
];

/** 用高召回确定性规则筛选招聘流程候选，稳定负例不会消耗模型调用。 */
export class RecruitmentMailCandidateScreener {
  public readonly version = 'candidate-rules-v4';

  /** 1、识别强流程信号；2、排除稳定负例；3、组合弱信号并保守放行未知模板。 */
  public screen(mail: PreparedRecruitmentMail): RecruitmentMailCandidateDecision {
    const value = `${mail.subject}\n${mail.senderName}\n${mail.senderDomain}\n${mail.currentBody}`;
    const strong = strongEventRules.filter((rule) => rule.pattern.test(value));
    const negatives = stableNegativeRules.filter((rule) => rule.pattern.test(value));
    const supporting = supportingRules.filter((rule) => rule.pattern.test(value));

    // 2.a、主题明确的营销和体验调研可优先排除；正文页脚中的推广文字不能压过流程结束等真实事实。
    const dominantNegatives = stableNegativeRules.filter(
      (rule) => rule.code !== 'verification_code' && rule.pattern.test(mail.subject),
    );
    const excluded =
      dominantNegatives.length > 0 ? dominantNegatives : strong.length === 0 ? negatives : [];
    if (excluded.length > 0) {
      return recruitmentMailCandidateDecisionSchema.parse({
        candidate: false,
        confidence: 'excluded',
        reasonCodes: excluded.map((rule) => rule.code),
        policyVersion: this.version,
      });
    }
    const score = [...strong, ...supporting].reduce((total, rule) => total + rule.weight, 0);
    // 3.a、已知招聘系统仍需正文上下文，不能只凭域名推定邮件属于招聘流程。
    const trustedUnknown =
      strong.length === 0 &&
      negatives.length === 0 &&
      recognizedRecruitingDomains.test(mail.senderDomain) &&
      broadRecruitingContext.test(value);
    // 3.b、陌生发件人的个人应聘流程通知也保守放行，不要求已知域名或精确邀请模板。
    const unknownPersonalProcess =
      strong.length === 0 &&
      negatives.length === 0 &&
      /应聘|投递|录用|offer|面试|笔试|测评|applicant|candidate|interview|assessment|recruitment/iu.test(
        value,
      ) &&
      /您|你的|你已|请|\byour\b|\bplease\b|\bapplicant\b|\bcandidate\b/iu.test(value);
    const candidate = strong.length > 0 || score >= 2 || trustedUnknown || unknownPersonalProcess;
    return recruitmentMailCandidateDecisionSchema.parse({
      candidate,
      confidence: strong.length > 0 ? 'strong' : candidate ? 'possible' : 'excluded',
      reasonCodes: candidate
        ? [
            ...strong.map((rule) => rule.code),
            ...supporting.map((rule) => rule.code),
            ...(trustedUnknown ? ['known_recruiting_sender_unknown_template'] : []),
            ...(unknownPersonalProcess ? ['personal_process_unknown_template'] : []),
          ]
        : ['no_recruitment_process_signal'],
      policyVersion: this.version,
    });
  }
}
