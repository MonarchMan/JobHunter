import {
  jobApplicationStatusSchema,
  recruitmentMailEventTypeSchema,
  recruitmentScheduleFactSchema,
  type JobApplicationStatus,
  type RecruitmentScheduleFact,
} from '@jobhunter/domain';
import { z } from 'zod';

/** 数据库边界返回的申请事件；不包含邮件正文，只保留进展展示所需事实。 */
export const applicationProgressEventSchema = z
  .object({
    id: z.string().min(1),
    eventType: recruitmentMailEventTypeSchema,
    effectiveAt: z.number().int().nonnegative(),
    receivedAt: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    schedule: recruitmentScheduleFactSchema.nullable(),
    location: z.string().nullable(),
    meetingUrl: z.url().nullable(),
    actionUrl: z.url().nullable(),
    sourceUrl: z.url().nullable(),
  })
  .extend({ stageLabel: z.string().min(1).max(320).nullable() })
  .strict();
export type ApplicationProgressEvent = z.infer<typeof applicationProgressEventSchema>;

/** 数据库边界返回的一条岗位申请及其不可变事件。 */
export const applicationProgressRecordSchema = z
  .object({
    id: z.string().min(1),
    companyId: z.string().nullable(),
    jobId: z.string().nullable(),
    companyName: z.string().min(1),
    roleTitle: z.string().min(1),
    status: jobApplicationStatusSchema,
    statusEffectiveAt: z.number().int().nonnegative().nullable(),
    updatedAt: z.number().int().nonnegative(),
    events: z.array(applicationProgressEventSchema),
  })
  .strict();
export type ApplicationProgressRecord = z.infer<typeof applicationProgressRecordSchema>;

/** 应聘进展查询仓储端口；基础设施只返回已校验的结构化事实。 */
export interface ApplicationProgressRepository {
  listApplicationProgress(): readonly ApplicationProgressRecord[];
}

export const applicationProgressStageSchema = z.enum([
  'applied',
  'assessment',
  'interview',
  'offer',
  'closed',
]);
export type ApplicationProgressStage = z.infer<typeof applicationProgressStageSchema>;

export const applicationProgressCompanyStatusSchema = z.enum([
  'in_progress',
  'needs_action',
  'offer',
  'closed',
]);
export type ApplicationProgressCompanyStatus = z.infer<
  typeof applicationProgressCompanyStatusSchema
>;

export const applicationProgressRoundSchema = z.object({
  key: z.string().min(1),
  roundNo: z.number().int().positive(),
  label: z.string().min(1),
  status: z.enum(['upcoming', 'completed', 'cancelled']),
  schedule: recruitmentScheduleFactSchema.nullable(),
  sourceEventId: z.string().min(1),
});
export type ApplicationProgressRound = z.infer<typeof applicationProgressRoundSchema>;

export interface ApplicationProgressApplication {
  readonly id: string;
  readonly companyId: string | null;
  readonly jobId: string | null;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly status: JobApplicationStatus;
  readonly stage: ApplicationProgressStage;
  readonly statusEffectiveAt: number | null;
  readonly updatedAt: number;
  readonly latestEventAt: number | null;
  readonly hasActionRequired: boolean;
  readonly rounds: readonly ApplicationProgressRound[];
  readonly events: readonly ApplicationProgressEvent[];
}

export interface ApplicationProgressCompany {
  readonly key: string;
  readonly companyName: string;
  readonly status: ApplicationProgressCompanyStatus;
  readonly totalApplications: number;
  readonly activeApplications: number;
  readonly actionRequiredApplications: number;
  readonly latestEventAt: number | null;
  readonly applications: readonly ApplicationProgressApplication[];
}

/** 将申请事件投影为公司分组、岗位流程条和面试轮次。 */
export class ApplicationProgressQueryService {
  readonly #repository: ApplicationProgressRepository;
  readonly #now: () => number;
  readonly #timezone: string;

  public constructor(
    repository: ApplicationProgressRepository,
    options: { readonly now?: () => number; readonly timezone?: string } = {},
  ) {
    this.#repository = repository;
    this.#now = options.now ?? Date.now;
    this.#timezone = options.timezone ?? 'Asia/Shanghai';
  }

  /** 1、校验仓储记录；2、构建岗位流程；3、按公司聚合并稳定排序。 */
  public list(): readonly ApplicationProgressCompany[] {
    const groups = new Map<string, ApplicationProgressApplication[]>();
    for (const raw of this.#repository.listApplicationProgress()) {
      const record = applicationProgressRecordSchema.parse(raw);
      const application = toApplication(record, this.#now(), this.#timezone);
      const key = companyKey(record.companyId, record.companyName);
      const current = groups.get(key) ?? [];
      current.push(application);
      groups.set(key, current);
    }
    return [...groups.entries()]
      .map(([key, applications]) => toCompany(key, applications))
      .sort(compareCompanies);
  }
}

function toApplication(
  record: ApplicationProgressRecord,
  now: number,
  timezone: string,
): ApplicationProgressApplication {
  const events = [...record.events].sort(compareEvents);
  const latestEventAt =
    events.length === 0 ? null : Math.max(...events.map((event) => event.effectiveAt));
  const hasActionRequired =
    record.status !== 'rejected' &&
    record.status !== 'closed' &&
    events.some((event) => event.eventType === 'action_required');
  return {
    id: record.id,
    companyId: record.companyId,
    jobId: record.jobId,
    companyName: record.companyName,
    roleTitle: record.roleTitle,
    status: record.status,
    stage: stageFor(record.status),
    statusEffectiveAt: record.statusEffectiveAt,
    updatedAt: record.updatedAt,
    latestEventAt,
    hasActionRequired,
    rounds: buildRounds(events, now, timezone),
    events: [...events].sort((left, right) => compareEvents(right, left)),
  };
}

function toCompany(
  key: string,
  applications: readonly ApplicationProgressApplication[],
): ApplicationProgressCompany {
  const sorted = [...applications].sort(compareApplications);
  const activeApplications = sorted.filter((item) => item.stage !== 'closed').length;
  const actionRequiredApplications = sorted.filter((item) => item.hasActionRequired).length;
  const hasOffer = sorted.some((item) => item.stage === 'offer');
  const status: ApplicationProgressCompanyStatus =
    actionRequiredApplications > 0
      ? 'needs_action'
      : hasOffer
        ? 'offer'
        : activeApplications > 0
          ? 'in_progress'
          : 'closed';
  const latestEventAt = sorted.reduce<number | null>(
    (latest, item) =>
      item.latestEventAt === null
        ? latest
        : latest === null
          ? item.latestEventAt
          : Math.max(latest, item.latestEventAt),
    null,
  );
  return {
    key,
    companyName: sorted[0]?.companyName ?? '未知',
    status,
    totalApplications: sorted.length,
    activeApplications,
    actionRequiredApplications,
    latestEventAt,
    applications: sorted,
  };
}

function buildRounds(
  events: readonly ApplicationProgressEvent[],
  now: number,
  timezone: string,
): readonly ApplicationProgressRound[] {
  const rounds: {
    key: string;
    label: string;
    events: ApplicationProgressEvent[];
  }[] = [];
  for (const event of events) {
    if (
      event.eventType !== 'interview_invited' &&
      event.eventType !== 'interview_rescheduled' &&
      event.eventType !== 'interview_cancelled'
    )
      continue;
    let label = event.stageLabel?.trim() ?? null;
    if (label === '') label = null;
    const match = rounds.find((round) => {
      if (label !== null) return round.label === label;
      const latest = round.events.at(-1);
      return (
        latest?.schedule !== null &&
        latest?.schedule !== undefined &&
        sameInterviewSlot(latest.schedule, event.schedule)
      );
    });
    if (match) match.events.push(event);
    else {
      const roundNo = rounds.length + 1;
      rounds.push({
        key: `round-${String(roundNo)}`,
        label: label ?? `第${toChineseNumber(roundNo)}轮面试`,
        events: [event],
      });
    }
  }
  return rounds.map((round, index) => {
    const latest = [...round.events].sort(compareEvents).at(-1) ?? round.events[0];
    const cancelled = latest?.eventType === 'interview_cancelled';
    return {
      key: round.key,
      roundNo: index + 1,
      label: round.label,
      status: cancelled ? 'cancelled' : scheduleStatus(latest?.schedule ?? null, now, timezone),
      schedule: latest?.schedule ?? null,
      sourceEventId: latest?.id ?? round.events[0]?.id ?? round.key,
    };
  });
}

function stageFor(status: JobApplicationStatus): ApplicationProgressStage {
  switch (status) {
    case 'assessment':
      return 'assessment';
    case 'interview':
      return 'interview';
    case 'offer_intent':
    case 'offered':
      return 'offer';
    case 'rejected':
    case 'closed':
      return 'closed';
    default:
      return 'applied';
  }
}

function scheduleStatus(
  schedule: RecruitmentScheduleFact | null,
  now: number,
  timezone: string,
): 'upcoming' | 'completed' {
  if (schedule === null) return 'upcoming';
  const instant = schedule.scheduledEndAt ?? schedule.scheduledStartAt ?? schedule.deadlineAt;
  if (instant !== null) return now > instant ? 'completed' : 'upcoming';
  const date =
    schedule.scheduledEndLocalDate ??
    schedule.scheduledStartLocalDate ??
    schedule.deadlineLocalDate;
  if (date === null) return 'upcoming';
  return localDate(now, timezone) > date ? 'completed' : 'upcoming';
}

function compareEvents(left: ApplicationProgressEvent, right: ApplicationProgressEvent): number {
  return (
    left.effectiveAt - right.effectiveAt ||
    left.receivedAt - right.receivedAt ||
    left.id.localeCompare(right.id)
  );
}

function compareApplications(
  left: ApplicationProgressApplication,
  right: ApplicationProgressApplication,
): number {
  return (
    (right.latestEventAt ?? right.updatedAt) - (left.latestEventAt ?? left.updatedAt) ||
    left.roleTitle.localeCompare(right.roleTitle)
  );
}

function compareCompanies(
  left: ApplicationProgressCompany,
  right: ApplicationProgressCompany,
): number {
  return (
    (right.latestEventAt ?? 0) - (left.latestEventAt ?? 0) ||
    left.companyName.localeCompare(right.companyName)
  );
}

function sameInterviewSlot(
  left: RecruitmentScheduleFact | null,
  right: RecruitmentScheduleFact | null,
): boolean {
  if (left === null || right === null) return false;
  return (
    left.scheduledStartAt === right.scheduledStartAt &&
    left.scheduledStartLocalDate === right.scheduledStartLocalDate &&
    left.previousScheduledStartAt === right.previousScheduledStartAt &&
    left.previousScheduledStartLocalDate === right.previousScheduledStartLocalDate
  );
}

function companyKey(companyId: string | null, companyName: string): string {
  return companyId ?? companyName.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
}

function localDate(value: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year ?? '0000'}-${values.month ?? '00'}-${values.day ?? '00'}`;
}

function toChineseNumber(value: number): string {
  return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][value] ?? String(value);
}
