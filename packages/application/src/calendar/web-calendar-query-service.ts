import {
  webCalendarQuerySchema,
  webCalendarRangeSchema,
  type WebCalendarQuery,
  type WebCalendarRange,
} from '../contracts/web.js';
import type { CalendarQueryService } from './calendar-query-service.js';

/** 将招聘日历查询适配为稳定的 Web 输入输出契约。 */
export class WebCalendarQueryService {
  readonly #calendar: CalendarQueryService;

  public constructor(calendar: CalendarQueryService) {
    this.#calendar = calendar;
  }

  /** 1、校验日期范围；2、查询当前有效日程；3、把内部时间戳转换为 ISO 字符串。 */
  public list(input: WebCalendarQuery): WebCalendarRange {
    const query = webCalendarQuerySchema.parse(input);
    const items = this.#calendar.list(query).map((item) => ({
      id: item.id,
      sourceEventId: item.sourceEventId,
      applicationId: item.applicationId,
      companyName: item.companyName,
      roleTitle: item.roleTitle,
      activityType: item.schedule.activityType,
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

/** 把可空内部时间戳转换为 Web ISO 时间。 */
function toIsoString(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
