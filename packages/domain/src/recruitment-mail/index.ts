import { z } from 'zod';
import { type CompanyId, type JobId, type UtcInstant, utcInstantSchema } from '../shared/index.js';

/** 招聘邮件可识别的申请流程事件类型。 */
export const recruitmentMailEventTypeSchema = z.enum([
  'application_acknowledged',
  'assessment_invited',
  'interview_invited',
  'interview_rescheduled',
  'interview_cancelled',
  'action_required',
  'process_updated',
  'rejected',
  'process_closed',
  'offer_intent',
  'offer_issued',
  'other_recruiting',
  'not_recruiting',
]);
export type RecruitmentMailEventType = z.infer<typeof recruitmentMailEventTypeSchema>;

/** 申请当前状态；状态只能由稳定邮件事实推进。 */
export const jobApplicationStatusSchema = z.enum([
  'unknown',
  'applied',
  'assessment',
  'interview',
  'offer_intent',
  'offered',
  'rejected',
  'closed',
]);
export type JobApplicationStatus = z.infer<typeof jobApplicationStatusSchema>;

/** 分类器对一封邮件的结论。 */
export const recruitmentMailDecisionSchema = z.enum(['accepted', 'needs_review', 'ignored']);
export type RecruitmentMailDecision = z.infer<typeof recruitmentMailDecisionSchema>;

/** 可进入求职日历的招聘活动类型。 */
export const recruitmentScheduleActivityTypeSchema = z.enum([
  'interview',
  'written_exam',
  'assessment',
  'coding_test',
]);
export type RecruitmentScheduleActivityType = z.infer<typeof recruitmentScheduleActivityTypeSchema>;

/** 日程事实的时间精度；仅日期事实不得伪造为午夜时间。 */
export const recruitmentScheduleTimePrecisionSchema = z.enum([
  'exact_time',
  'date_only',
  'time_range',
  'date_range',
  'unknown',
]);
export type RecruitmentScheduleTimePrecision = z.infer<
  typeof recruitmentScheduleTimePrecisionSchema
>;

/** 日程时间使用的时区来源。 */
export const recruitmentScheduleTimezoneSourceSchema = z.enum([
  'explicit',
  'mailbox_default',
  'not_applicable',
  'unknown',
]);
export type RecruitmentScheduleTimezoneSource = z.infer<
  typeof recruitmentScheduleTimezoneSourceSchema
>;

/** 招聘邮件中的可执行日程事实；改期旧时间只用于定位待替换安排。 */
export const recruitmentScheduleFactSchema = z
  .object({
    activityType: recruitmentScheduleActivityTypeSchema,
    scheduledStartAt: utcInstantSchema.nullable(),
    scheduledEndAt: utcInstantSchema.nullable(),
    deadlineAt: utcInstantSchema.nullable(),
    scheduledStartLocalDate: z.iso.date().nullable(),
    scheduledEndLocalDate: z.iso.date().nullable(),
    deadlineLocalDate: z.iso.date().nullable(),
    previousScheduledStartAt: utcInstantSchema.nullable(),
    previousScheduledStartLocalDate: z.iso.date().nullable(),
    timePrecision: recruitmentScheduleTimePrecisionSchema,
    timezoneSource: recruitmentScheduleTimezoneSourceSchema,
    timezoneText: z.string().min(1).max(128).nullable(),
    stageLabel: z.string().min(1).max(320).nullable(),
  })
  .strict();
export type RecruitmentScheduleFact = z.infer<typeof recruitmentScheduleFactSchema>;

/** 招聘邮件分类结果；不允许凭空填充不确定字段。 */
export const recruitmentMailClassificationSchema = z.object({
  eventType: recruitmentMailEventTypeSchema,
  decision: recruitmentMailDecisionSchema,
  companyName: z.string().min(1).max(320).nullable(),
  roleTitle: z.string().min(1).max(320).nullable(),
  applicationKey: z.string().max(320).nullable(),
  effectiveAt: utcInstantSchema.nullable(),
  schedule: recruitmentScheduleFactSchema.nullable(),
  location: z.string().max(1000).nullable(),
  meetingUrl: z.url().nullable(),
  actionUrl: z.url().nullable(),
  recruiterName: z.string().max(320).nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().max(500)).max(8),
  classifierKind: z.enum(['rules', 'agent']),
  classifierVersion: z.string().min(1),
});
export type RecruitmentMailClassification = z.infer<typeof recruitmentMailClassificationSchema>;

/** 求职申请当前投影。 */
export interface JobApplication {
  readonly id: string;
  readonly companyId: CompanyId | null;
  readonly jobId: JobId | null;
  readonly externalApplicationKeyHash: string | null;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly status: JobApplicationStatus;
  readonly statusEffectiveAt: UtcInstant | null;
  readonly revision: number;
}

/** 申请事件保存所需的不可变事实。 */
export interface ApplicationEvent {
  readonly id: string;
  readonly applicationId: string;
  readonly sequenceNo: number;
  readonly mailMessageRefId: string;
  readonly sourceContentHash: string;
  readonly sourceEventNo: number;
  readonly acceptanceKind: 'automatic' | 'user_confirmed';
  readonly classifierKind: 'rules' | 'agent';
  readonly classifierVersion: string;
  readonly eventType: RecruitmentMailEventType;
  readonly effectiveAt: UtcInstant;
  readonly receivedAt: UtcInstant;
  readonly confidence: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** 将招聘事件映射为申请状态；不改变状态的流程事件返回 null。 */
export function projectApplicationStatus(
  eventType: RecruitmentMailEventType,
): JobApplicationStatus | null {
  switch (eventType) {
    case 'application_acknowledged':
      return 'applied';
    case 'assessment_invited':
      return 'assessment';
    case 'interview_invited':
    case 'interview_rescheduled':
      return 'interview';
    case 'offer_intent':
      return 'offer_intent';
    case 'offer_issued':
      return 'offered';
    case 'rejected':
      return 'rejected';
    case 'process_closed':
      return 'closed';
    default:
      return null;
  }
}

/** 判断新事件能否覆盖当前状态，防止乱序旧邮件回退流程。 */
export function shouldProjectStatus(
  current: JobApplication,
  eventType: RecruitmentMailEventType,
  effectiveAt: UtcInstant,
): boolean {
  if (eventType === 'offer_intent' && current.status === 'offered') return false;
  const next = projectApplicationStatus(eventType);
  if (!next) return false;
  return current.statusEffectiveAt === null || effectiveAt >= current.statusEffectiveAt;
}
