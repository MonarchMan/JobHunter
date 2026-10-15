import {
  recruitmentScheduleFactSchema,
  utcInstant,
  utcInstantSchema,
  type RecruitmentScheduleFact,
  type UtcInstant,
} from '@jobhunter/domain';
import { z } from 'zod';

/** 会改变求职日历投影的申请事件类型。 */
export const calendarSourceEventTypeSchema = z.enum([
  'assessment_invited',
  'interview_invited',
  'interview_rescheduled',
  'interview_cancelled',
]);
export type CalendarSourceEventType = z.infer<typeof calendarSourceEventTypeSchema>;

/** Repository 返回的已确认日程来源事件；数据库边界必须完成运行时校验。 */
export const calendarSourceEventSchema = z
  .object({
    id: z.string().min(1),
    applicationId: z.string().min(1),
    sequenceNo: z.number().int().positive(),
    companyName: z.string().min(1),
    roleTitle: z.string().min(1),
    eventType: calendarSourceEventTypeSchema,
    effectiveAt: utcInstantSchema,
    receivedAt: utcInstantSchema,
    schedule: recruitmentScheduleFactSchema,
    location: z.string().nullable(),
    meetingUrl: z.url().nullable(),
    actionUrl: z.url().nullable(),
  })
  .strict();
export type CalendarSourceEvent = z.infer<typeof calendarSourceEventSchema>;

/** 日历查询只读取已确认的申请事件，不拥有新的日程事实。 */
export interface ApplicationCalendarRepository {
  listScheduleEvents(): readonly CalendarSourceEvent[];
}

/** 日期范围查询；起止日期均按指定时区解释且包含 dateTo 当天。 */
export interface CalendarRangeQuery {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly timezone: string;
}

/** 当前有效日程；改期沿用原条目 ID，只更新来源事件和时间。 */
export interface ApplicationCalendarItem {
  readonly id: string;
  readonly sourceEventId: string;
  readonly applicationId: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly schedule: RecruitmentScheduleFact;
  readonly location: string | null;
  readonly meetingUrl: string | null;
  readonly actionUrl: string | null;
  readonly receivedAt: UtcInstant;
}

/** 招聘日历日期范围查询服务。 */
export class CalendarQueryService {
  readonly #repository: ApplicationCalendarRepository;

  public constructor(repository: ApplicationCalendarRepository) {
    this.#repository = repository;
  }

  /** 1、按事件序列重建当前日程；2、按用户时区过滤日期范围；3、稳定排序。 */
  public list(input: CalendarRangeQuery): readonly ApplicationCalendarItem[] {
    const range = calendarRange(input);
    return projectCalendar(this.#repository.listScheduleEvents())
      .filter((item) => overlapsRange(item.schedule, range))
      .sort(compareCalendarItems);
  }
}

/** 从不可变申请事件重建当前有效日程，不产生“已改期”或“已取消”展示项。 */
export function projectCalendar(
  sourceEvents: readonly CalendarSourceEvent[],
): readonly ApplicationCalendarItem[] {
  const active = new Map<string, ApplicationCalendarItem>();
  const ordered = [...sourceEvents].sort(
    (left, right) =>
      left.applicationId.localeCompare(right.applicationId) || left.sequenceNo - right.sequenceNo,
  );

  for (const event of ordered) {
    // 1、新邀请直接形成当前日程；每封独立测评或面试邀请保留自己的稳定条目。
    if (event.eventType === 'assessment_invited' || event.eventType === 'interview_invited') {
      active.set(event.id, calendarItem(event, event.id));
      continue;
    }

    // 2、改期优先用原时间定位，其次使用明确阶段或唯一活动；未匹配时保留新安排避免漏项。
    const target = findInterviewTarget(active, event);
    if (event.eventType === 'interview_rescheduled') {
      const stableId = target?.id ?? event.id;
      if (target) active.delete(target.id);
      active.set(stableId, calendarItem(event, stableId));
      continue;
    }

    // 3、取消只移除匹配的当前日程；取消事件本身不会成为日历项目。
    if (target) active.delete(target.id);
  }
  return [...active.values()];
}

/** 创建一个当前日程快照；稳定 ID 与最近来源事件 ID 分离。 */
function calendarItem(event: CalendarSourceEvent, id: string): ApplicationCalendarItem {
  return {
    id,
    sourceEventId: event.id,
    applicationId: event.applicationId,
    companyName: event.companyName,
    roleTitle: event.roleTitle,
    schedule: event.schedule,
    location: event.location,
    meetingUrl: event.meetingUrl,
    actionUrl: event.actionUrl,
    receivedAt: event.receivedAt,
  };
}

/** 通过原时间和阶段定位改期或取消目标，避免影响同一申请中的其他轮次面试。 */
function findInterviewTarget(
  active: ReadonlyMap<string, ApplicationCalendarItem>,
  event: CalendarSourceEvent,
): ApplicationCalendarItem | null {
  const candidates = [...active.values()].filter(
    (item) =>
      item.applicationId === event.applicationId && item.schedule.activityType === 'interview',
  );
  const previousInstant = event.schedule.previousScheduledStartAt;
  const previousDate = event.schedule.previousScheduledStartLocalDate;
  if (previousInstant !== null || previousDate !== null) {
    const byPreviousTime = candidates.filter(
      (item) =>
        (previousInstant !== null && item.schedule.scheduledStartAt === previousInstant) ||
        (previousDate !== null && item.schedule.scheduledStartLocalDate === previousDate),
    );
    if (byPreviousTime.length === 1) return byPreviousTime[0] ?? null;
  }
  if (event.schedule.stageLabel !== null) {
    const byStage = candidates.filter(
      (item) => item.schedule.stageLabel === event.schedule.stageLabel,
    );
    if (byStage.length === 1) return byStage[0] ?? null;
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

interface ResolvedCalendarRange {
  readonly startAt: UtcInstant;
  readonly endAtExclusive: UtcInstant;
  readonly dateFrom: string;
  readonly dateTo: string;
}

/** 校验日期与时区，并把本地日期边界换算为 UTC 半开区间。 */
function calendarRange(input: CalendarRangeQuery): ResolvedCalendarRange {
  const dateFrom = parseLocalDate(input.dateFrom);
  const dateTo = parseLocalDate(input.dateTo);
  if (dateFrom > dateTo) throw new TypeError('Calendar dateFrom must not exceed dateTo.');
  assertTimezone(input.timezone);
  return {
    startAt: startOfLocalDate(dateFrom, input.timezone),
    endAtExclusive: startOfLocalDate(nextLocalDate(dateTo), input.timezone),
    dateFrom,
    dateTo,
  };
}

/** 同时处理精确时间和仅日期事项；结束字段为空时按单点事项判断。 */
function overlapsRange(schedule: RecruitmentScheduleFact, range: ResolvedCalendarRange): boolean {
  const instantStart = schedule.scheduledStartAt ?? schedule.deadlineAt;
  if (instantStart !== null) {
    const instantEnd = schedule.scheduledEndAt ?? schedule.deadlineAt ?? instantStart;
    return instantStart < range.endAtExclusive && instantEnd >= range.startAt;
  }
  const localStart = schedule.scheduledStartLocalDate ?? schedule.deadlineLocalDate;
  if (localStart === null) return false;
  const localEnd = schedule.scheduledEndLocalDate ?? schedule.deadlineLocalDate ?? localStart;
  return localStart <= range.dateTo && localEnd >= range.dateFrom;
}

/** 按实际或本地开始时间排序，无时间事项由后续“时间待定区”单独查询。 */
function compareCalendarItems(
  left: ApplicationCalendarItem,
  right: ApplicationCalendarItem,
): number {
  const leftKey = calendarSortKey(left.schedule);
  const rightKey = calendarSortKey(right.schedule);
  return (
    leftKey - rightKey ||
    left.companyName.localeCompare(right.companyName) ||
    left.roleTitle.localeCompare(right.roleTitle)
  );
}

/** 为精确时间和仅日期事项生成稳定排序键；无时间项目排在范围结果末尾。 */
function calendarSortKey(schedule: RecruitmentScheduleFact): number {
  const instant = schedule.scheduledStartAt ?? schedule.deadlineAt;
  if (instant !== null) return instant;
  const localDate = schedule.scheduledStartLocalDate ?? schedule.deadlineLocalDate;
  return localDate === null ? Number.POSITIVE_INFINITY : Date.parse(`${localDate}T00:00:00Z`);
}

/** 只接受真实 ISO 本地日期，避免 JavaScript 自动归一化非法日期。 */
function parseLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new TypeError('Calendar date must use YYYY-MM-DD.');
  const instant = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(instant).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Calendar date is invalid.');
  }
  return value;
}

/** 返回下一个本地日历日期，不使用宿主机时区。 */
function nextLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 0) + 1)).toISOString().slice(0, 10);
}

/** 把指定时区的本地午夜换算为 UTC；迭代用于吸收夏令时偏移变化。 */
function startOfLocalDate(value: string, timezone: string): UtcInstant {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(candidate)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year ?? 0,
      (parts.month ?? 1) - 1,
      parts.day ?? 1,
      parts.hour ?? 0,
      parts.minute ?? 0,
      parts.second ?? 0,
    );
    const correction = target - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return utcInstant(candidate);
}

/** 提前拒绝运行时不支持的 IANA 时区。 */
function assertTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch (error) {
    throw new TypeError('Calendar timezone is invalid.', { cause: error });
  }
}
