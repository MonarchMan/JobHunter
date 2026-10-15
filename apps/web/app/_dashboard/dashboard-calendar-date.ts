import type { WebCalendarItem } from '@jobhunter/application/web';

/** 月历固定使用周一作为每周第一天。 */
export const calendarWeekdays = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** 将时间戳转换为指定 IANA 时区的本地日期。 */
export function dateInTimezone(value: number | string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year ?? '0000'}-${values.month ?? '00'}-${values.day ?? '00'}`;
}

/** 从任意本地日期取得所在月份的第一天。 */
export function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

/** 在不依赖宿主机时区的情况下移动月份。 */
export function addMonths(value: string, amount: number): string {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1 + amount, 1)).toISOString().slice(0, 10);
}

/** 在不依赖宿主机时区的情况下移动本地日历日期。 */
export function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount))
    .toISOString()
    .slice(0, 10);
}

/** 返回完整六周月历网格及其查询边界。 */
export function calendarGrid(value: string): {
  readonly dates: readonly string[];
  readonly dateFrom: string;
  readonly dateTo: string;
} {
  const first = monthStart(value);
  const [year, month] = first.split('-').map(Number);
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const dateFrom = addDays(first, -mondayOffset);
  const dates = Array.from({ length: 42 }, (_, index) => addDays(dateFrom, index));
  return { dates, dateFrom, dateTo: dates[dates.length - 1] ?? dateFrom };
}

/** 返回日程在指定时区下覆盖的本地日期范围。 */
export function calendarItemDateRange(
  item: WebCalendarItem,
  timezone: string,
): { readonly start: string; readonly end: string } | null {
  // 1、精确时间优先按用户时区换算；2、仅日期事实保持原始本地日期，不进行 UTC 转换。
  const instantStart = item.scheduledStartAt ?? item.deadlineAt;
  if (instantStart !== null) {
    const instantEnd = item.scheduledEndAt ?? item.deadlineAt ?? instantStart;
    return {
      start: dateInTimezone(instantStart, timezone),
      end: dateInTimezone(instantEnd, timezone),
    };
  }
  const localStart = item.scheduledStartLocalDate ?? item.deadlineLocalDate;
  if (localStart === null) return null;
  return {
    start: localStart,
    end: item.scheduledEndLocalDate ?? item.deadlineLocalDate ?? localStart,
  };
}

/** 判断日程是否覆盖指定日期，供月历单元格和详情列表共享。 */
export function calendarItemOccursOn(
  item: WebCalendarItem,
  date: string,
  timezone: string,
): boolean {
  const range = calendarItemDateRange(item, timezone);
  return range !== null && range.start <= date && range.end >= date;
}

/** 按日程首日和公司名称稳定排序。 */
export function sortCalendarItems(
  items: readonly WebCalendarItem[],
  timezone: string,
): WebCalendarItem[] {
  return [...items].sort((left, right) => {
    const leftDate = calendarItemDateRange(left, timezone)?.start ?? '9999-12-31';
    const rightDate = calendarItemDateRange(right, timezone)?.start ?? '9999-12-31';
    return (
      leftDate.localeCompare(rightDate) ||
      left.companyName.localeCompare(right.companyName) ||
      left.roleTitle.localeCompare(right.roleTitle)
    );
  });
}
