import {
  webCalendarQuerySchema,
  webCalendarRangeSchema,
  type WebCalendarQuery,
  type WebCalendarRange,
} from '../contracts/web.js';
import type { RecruitmentScheduleFact } from '@jobhunter/domain';
import type { CalendarQueryService } from './calendar-query-service.js';

/** 将招聘日历查询适配为稳定的 Web 输入输出契约。 */
export class WebCalendarQueryService {
  readonly #calendar: CalendarQueryService;
  readonly #now: () => number;

  public constructor(calendar: CalendarQueryService, now: () => number = Date.now) {
    this.#calendar = calendar;
    this.#now = now;
  }

  /** 1、校验日期范围；2、查询当前有效日程；3、派生时间状态并转换 Web 时间格式。 */
  public list(input: WebCalendarQuery): WebCalendarRange {
    const query = webCalendarQuerySchema.parse(input);
    const items = this.#calendar.list(query).map((item) => ({
      id: item.id,
      sourceEventId: item.sourceEventId,
      applicationId: item.applicationId,
      companyName: item.companyName,
      roleTitle: item.roleTitle,
      activityType: item.schedule.activityType,
      timingStatus: calendarTimingStatus(item.schedule, this.#now(), query.timezone),
      stageLabel: item.schedule.stageLabel,
      scheduledStartAt: toIsoString(item.schedule.scheduledStartAt),
      scheduledEndAt: toIsoString(item.schedule.scheduledEndAt),
      deadlineAt: toIsoString(item.schedule.deadlineAt),
      scheduledStartLocalDate: item.schedule.scheduledStartLocalDate,
      scheduledEndLocalDate: item.schedule.scheduledEndLocalDate,
      deadlineLocalDate: item.schedule.deadlineLocalDate,
      timePrecision: item.schedule.timePrecision,
      timezoneSource: item.schedule.timezoneSource,
      timezoneText: item.schedule.timezoneText,
      location: item.location,
      meetingUrl: item.meetingUrl,
      actionUrl: item.actionUrl,
      receivedAt: new Date(item.receivedAt).toISOString(),
    }));
    return webCalendarRangeSchema.parse({ items });
  }
}

/** 固定安排或截止事项的时间过去后统一标记 completed；状态不写回事实表。 */
function calendarTimingStatus(
  schedule: RecruitmentScheduleFact,
  now: number,
  timezone: string,
): 'upcoming' | 'completed' {
  if (schedule.deadlineAt !== null) return now > schedule.deadlineAt ? 'completed' : 'upcoming';
  const today = localDate(now, timezone);
  if (schedule.deadlineLocalDate !== null) {
    return today > schedule.deadlineLocalDate ? 'completed' : 'upcoming';
  }
  const scheduledEnd = schedule.scheduledEndAt ?? schedule.scheduledStartAt;
  if (scheduledEnd !== null) return now > scheduledEnd ? 'completed' : 'upcoming';
  const scheduledLocalEnd = schedule.scheduledEndLocalDate ?? schedule.scheduledStartLocalDate;
  return scheduledLocalEnd !== null && today > scheduledLocalEnd ? 'completed' : 'upcoming';
}

/** 将当前时刻转换为用户时区的 ISO 本地日期。 */
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

/** 把可空内部时间戳转换为 Web ISO 时间。 */
function toIsoString(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
