'use client';

import type { WebCalendarItem } from '@jobhunter/application/contracts';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Icon } from '../components/ui-icon.js';
import {
  addMonths,
  calendarGrid,
  calendarItemDateRange,
  calendarItemOccursOn,
  calendarWeekdays,
  monthStart,
  sortCalendarItems,
} from './dashboard-calendar-date.js';
import styles from './dashboard-calendar.module.css';

type ActivityFilter = 'all' | WebCalendarItem['activityType'];

const activityLabels: Readonly<Record<WebCalendarItem['activityType'], string>> = {
  interview: '面试',
  written_exam: '笔试',
  assessment: '测评',
};

const activityFilters: readonly ActivityFilter[] = [
  'all',
  'interview',
  'written_exam',
  'assessment',
];

const timingStatusLabels: Readonly<Record<WebCalendarItem['timingStatus'], string>> = {
  upcoming: '待进行',
  completed: '已完成',
};

/** 浏览器只校验日历响应本身，避免把应用层服务端聚合入口打入客户端包。 */
const calendarResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          sourceEventId: z.string().min(1),
          applicationId: z.string().min(1),
          companyName: z.string().min(1),
          roleTitle: z.string().min(1),
          activityType: z.enum(['interview', 'written_exam', 'assessment']),
          timingStatus: z.enum(['upcoming', 'completed']),
          stageLabel: z.string().min(1).max(320).nullable(),
          scheduledStartAt: z.iso.datetime().nullable(),
          scheduledEndAt: z.iso.datetime().nullable(),
          deadlineAt: z.iso.datetime().nullable(),
          scheduledStartLocalDate: z.iso.date().nullable(),
          scheduledEndLocalDate: z.iso.date().nullable(),
          deadlineLocalDate: z.iso.date().nullable(),
          timePrecision: z.enum(['exact_time', 'date_only', 'time_range', 'date_range', 'unknown']),
          timezoneSource: z.enum(['explicit', 'mailbox_default', 'not_applicable', 'unknown']),
          timezoneText: z.string().min(1).max(128).nullable(),
          location: z.string().nullable(),
          meetingUrl: z.url().nullable(),
          actionUrl: z.url().nullable(),
          receivedAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();

/** 工作台日历首屏数据。 */
export interface DashboardCalendarProps {
  readonly initialItems: readonly WebCalendarItem[];
  readonly initialMonth: string;
  readonly today: string;
  readonly timezone: string;
}

/** 工作台近期日程缩略卡片及弹窗式完整月历。 */
export function DashboardCalendar({
  initialItems,
  initialMonth,
  today,
  timezone,
}: DashboardCalendarProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(initialMonth));
  const [selectedDate, setSelectedDate] = useState(today);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [items, setItems] = useState<readonly WebCalendarItem[]>(initialItems);
  const [loadedMonths, setLoadedMonths] = useState<readonly string[]>([monthStart(initialMonth)]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const triggerReference = useRef<HTMLButtonElement>(null);

  const miniGrid = useMemo(() => calendarGrid(initialMonth), [initialMonth]);
  const upcomingItems = useMemo(
    () =>
      sortCalendarItems(
        items.filter((item) => {
          const range = calendarItemDateRange(item, timezone);
          return range !== null && range.end >= today;
        }),
        timezone,
      ).slice(0, 5),
    [items, timezone, today],
  );

  /** 按需读取弹窗中尚未加载的月份，并按日程稳定 ID 合并缓存。 */
  async function loadMonth(month: string): Promise<void> {
    const key = monthStart(month);
    if (loadedMonths.includes(key)) return;
    const range = calendarGrid(key);
    setLoading(true);
    setLoadFailed(false);
    try {
      const query = new URLSearchParams({
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        timezone,
      });
      const response = await fetch(`/api/calendar?${query.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Calendar request failed with ${String(response.status)}.`);
      const payload: unknown = await response.json();
      const data = calendarResponseSchema.parse(readEnvelopeData(payload));
      setItems((current) => mergeCalendarItems(current, data.items));
      setLoadedMonths((current) => (current.includes(key) ? current : [...current, key]));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  /** 打开详情并把焦点日期定位到用户选择的日期。 */
  function openCalendar(date = today): void {
    setVisibleMonth(monthStart(date));
    setSelectedDate(date);
    setOpen(true);
  }

  return (
    <section className={styles.container} aria-labelledby="dashboard-calendar-title">
      <header className={styles.summaryHeader}>
        <div>
          <div className={styles.titleLine}>
            <span className={styles.titleIcon} aria-hidden="true">
              <Icon name="calendar" size={18} />
            </span>
            <h2 id="dashboard-calendar-title">近期日程</h2>
          </div>
          <p>面试、笔试和测评安排</p>
        </div>
        <button
          ref={triggerReference}
          type="button"
          className={styles.expandButton}
          aria-label="展开招聘日程"
          onClick={() => {
            openCalendar();
          }}
        >
          <Icon name="expand" size={18} />
        </button>
      </header>

      <div className={styles.summaryBody}>
        <div className={styles.miniCalendar}>
          <strong>{formatMonth(initialMonth)}</strong>
          <CalendarWeekHeader compact />
          <div className={styles.miniGrid}>
            {miniGrid.dates.map((date) => {
              const dayItems = items.filter((item) => calendarItemOccursOn(item, date, timezone));
              const inMonth = date.startsWith(initialMonth.slice(0, 7));
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    styles.miniDay,
                    inMonth ? undefined : styles.outsideMonth,
                    date === today ? styles.today : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={`${formatDateLabel(date)}，${String(dayItems.length)} 项日程`}
                  onClick={() => {
                    if (!inMonth) void loadMonth(monthStart(date));
                    openCalendar(date);
                  }}
                >
                  <span>{String(Number(date.slice(8, 10)))}</span>
                  {dayItems.length > 0 ? (
                    <span className={styles.dots} aria-hidden="true">
                      {dayItems.slice(0, 3).map((item) => (
                        <i key={item.id} className={activityClass(item.activityType)} />
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.upcoming}>
          <div className={styles.upcomingHeading}>
            <strong>接下来</strong>
            <span>
              {upcomingItems.length > 0 ? `${String(upcomingItems.length)} 项` : '暂无安排'}
            </span>
          </div>
          {upcomingItems.length > 0 ? (
            <ol className={styles.upcomingList}>
              {upcomingItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      openCalendar(calendarItemDateRange(item, timezone)?.start ?? today);
                    }}
                  >
                    <span
                      className={[styles.activityMark, activityClass(item.activityType)].join(' ')}
                    />
                    <span className={styles.upcomingContent}>
                      <strong>{item.stageLabel ?? activityLabels[item.activityType]}</strong>
                      <span>
                        {item.companyName} · {item.roleTitle}
                      </span>
                    </span>
                    <time>{formatCalendarTime(item, timezone)}</time>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <button
              type="button"
              className={styles.emptyState}
              onClick={() => {
                openCalendar();
              }}
            >
              <Icon name="calendar" size={24} />
              <span>
                <strong>近期暂无日程</strong>
                <small>新的面试或测评邀请会显示在这里</small>
              </span>
            </button>
          )}
        </div>
      </div>

      {open ? (
        <CalendarDialog
          items={items}
          visibleMonth={visibleMonth}
          selectedDate={selectedDate}
          today={today}
          timezone={timezone}
          activityFilter={activityFilter}
          loading={loading}
          loadFailed={loadFailed}
          returnFocusTo={triggerReference.current}
          onActivityFilterChange={setActivityFilter}
          onDateChange={setSelectedDate}
          onMonthChange={(month) => {
            setVisibleMonth(month);
            setSelectedDate(month);
            void loadMonth(month);
          }}
          onRetry={() => {
            void loadMonth(visibleMonth);
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

/** 招聘日程详情弹窗，桌面使用双栏月历，窄屏切换为纵向布局。 */
function CalendarDialog({
  items,
  visibleMonth,
  selectedDate,
  today,
  timezone,
  activityFilter,
  loading,
  loadFailed,
  returnFocusTo,
  onActivityFilterChange,
  onDateChange,
  onMonthChange,
  onRetry,
  onClose,
}: Readonly<{
  items: readonly WebCalendarItem[];
  visibleMonth: string;
  selectedDate: string;
  today: string;
  timezone: string;
  activityFilter: ActivityFilter;
  loading: boolean;
  loadFailed: boolean;
  returnFocusTo: HTMLButtonElement | null;
  onActivityFilterChange: (filter: ActivityFilter) => void;
  onDateChange: (date: string) => void;
  onMonthChange: (month: string) => void;
  onRetry: () => void;
  onClose: () => void;
}>): ReactElement {
  const dialogReference = useRef<HTMLDialogElement>(null);
  const grid = useMemo(() => calendarGrid(visibleMonth), [visibleMonth]);
  const filteredItems = useMemo(
    () =>
      activityFilter === 'all'
        ? items
        : items.filter((item) => item.activityType === activityFilter),
    [activityFilter, items],
  );
  const selectedItems = useMemo(
    () =>
      sortCalendarItems(
        filteredItems.filter((item) => calendarItemOccursOn(item, selectedDate, timezone)),
        timezone,
      ),
    [filteredItems, selectedDate, timezone],
  );

  useEffect(() => {
    const dialog = dialogReference.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogReference}
      className={styles.dialog}
      aria-labelledby="calendar-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className={styles.dialogHeader}>
        <div>
          <span>工作台日程</span>
          <h2 id="calendar-dialog-title">招聘日程</h2>
        </div>
        <button type="button" aria-label="关闭招聘日程" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className={styles.dialogToolbar}>
        <div className={styles.monthNavigation}>
          <button
            type="button"
            aria-label="上个月"
            onClick={() => {
              onMonthChange(addMonths(visibleMonth, -1));
            }}
          >
            <Icon name="chevronLeft" size={18} />
          </button>
          <strong>{formatMonth(visibleMonth)}</strong>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => {
              onMonthChange(addMonths(visibleMonth, 1));
            }}
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <button
            type="button"
            className={styles.todayButton}
            onClick={() => {
              onMonthChange(monthStart(today));
              onDateChange(today);
            }}
          >
            今天
          </button>
        </div>
        <div className={styles.filters} aria-label="日程类型筛选">
          {activityFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={activityFilter === filter}
              onClick={() => {
                onActivityFilterChange(filter);
              }}
            >
              {filter === 'all' ? '全部' : activityLabels[filter]}
            </button>
          ))}
        </div>
      </div>

      {loadFailed ? (
        <div className={styles.loadError} role="alert">
          <span>这个月份加载失败。</span>
          <button type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}

      <div className={styles.dialogBody} aria-busy={loading}>
        <div className={styles.fullCalendar}>
          <CalendarWeekHeader />
          <div className={styles.fullGrid}>
            {grid.dates.map((date) => {
              const dayItems = filteredItems.filter((item) =>
                calendarItemOccursOn(item, date, timezone),
              );
              const inMonth = date.startsWith(visibleMonth.slice(0, 7));
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    styles.fullDay,
                    inMonth ? undefined : styles.outsideMonth,
                    date === today ? styles.today : undefined,
                    date === selectedDate ? styles.selectedDay : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-label={`${formatDateLabel(date)}，${String(dayItems.length)} 项日程`}
                  aria-pressed={date === selectedDate}
                  onClick={() => {
                    if (!inMonth) onMonthChange(monthStart(date));
                    onDateChange(date);
                  }}
                >
                  <span className={styles.dayNumber}>{String(Number(date.slice(8, 10)))}</span>
                  <span className={styles.dayEvents} aria-hidden="true">
                    {dayItems.slice(0, 2).map((item) => (
                      <i
                        key={item.id}
                        className={[
                          activityClass(item.activityType),
                          timingStatusClass(item.timingStatus),
                        ].join(' ')}
                      >
                        {item.stageLabel ?? activityLabels[item.activityType]}
                      </i>
                    ))}
                    {dayItems.length > 2 ? <small>+{String(dayItems.length - 2)}</small> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {loading ? <div className={styles.loading}>正在加载月份数据…</div> : null}
        </div>

        <aside className={styles.agenda} aria-labelledby="selected-date-title">
          <header>
            <span>{formatWeekday(selectedDate)}</span>
            <h3 id="selected-date-title">{formatSelectedDate(selectedDate)}</h3>
          </header>
          {selectedItems.length > 0 ? (
            <ol className={styles.agendaList}>
              {selectedItems.map((item) => (
                <li
                  key={item.id}
                  className={[
                    activityClass(item.activityType),
                    timingStatusClass(item.timingStatus),
                  ].join(' ')}
                >
                  <div className={styles.agendaTitle}>
                    <span>{activityLabels[item.activityType]}</span>
                    <span
                      className={[styles.timingStatus, timingStatusClass(item.timingStatus)].join(
                        ' ',
                      )}
                      title="根据日程时间判断，不代表已实际参加或提交"
                    >
                      {timingStatusLabels[item.timingStatus]}
                    </span>
                    <time>{formatCalendarTime(item, timezone)}</time>
                  </div>
                  <h4>
                    {item.stageLabel ?? `${item.companyName}${activityLabels[item.activityType]}`}
                  </h4>
                  <p>
                    {item.companyName} · {item.roleTitle}
                  </p>
                  {item.location ? <p className={styles.location}>地点：{item.location}</p> : null}
                  {item.meetingUrl || item.actionUrl ? (
                    <div className={styles.agendaActions}>
                      {item.meetingUrl ? (
                        <a href={item.meetingUrl} target="_blank" rel="noreferrer">
                          进入会议 <Icon name="external" size={14} />
                        </a>
                      ) : null}
                      {item.actionUrl && item.actionUrl !== item.meetingUrl ? (
                        <a href={item.actionUrl} target="_blank" rel="noreferrer">
                          打开链接 <Icon name="external" size={14} />
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.emptyAgenda}>
              <Icon name="calendar" size={28} />
              <strong>当天没有安排</strong>
              <p>选择带有日程标记的日期查看详情。</p>
            </div>
          )}
        </aside>
      </div>
    </dialog>
  );
}

/** 月历星期标题。 */
function CalendarWeekHeader({ compact = false }: Readonly<{ compact?: boolean }>): ReactElement {
  return (
    <div className={compact ? styles.miniWeekdays : styles.weekdays} aria-hidden="true">
      {calendarWeekdays.map((weekday) => (
        <span key={weekday}>{weekday}</span>
      ))}
    </div>
  );
}

/** 读取统一成功响应中的 data 字段。 */
function readEnvelopeData(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new TypeError('Calendar response is missing data.');
  }
  return payload.data;
}

/** 合并月份查询结果，同一稳定日程只保留最新响应。 */
function mergeCalendarItems(
  current: readonly WebCalendarItem[],
  incoming: readonly WebCalendarItem[],
): readonly WebCalendarItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function activityClass(activityType: WebCalendarItem['activityType']): string {
  return styles[activityType] ?? '';
}

/** 返回派生时间状态样式，历史安排在月历和详情中保持一致反馈。 */
function timingStatusClass(status: WebCalendarItem['timingStatus']): string {
  return styles[`timing_${status}`] ?? '';
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return `${String(year)} 年 ${String(month)} 月`;
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatWeekday(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function formatSelectedDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

/** 根据精确时间、截止时间或仅日期事实生成人类可读时间。 */
function formatCalendarTime(item: WebCalendarItem, timezone: string): string {
  if (item.scheduledStartAt !== null) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(item.scheduledStartAt));
  }
  if (item.deadlineAt !== null) {
    return `截止 ${new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(item.deadlineAt))}`;
  }
  const range = calendarItemDateRange(item, timezone);
  if (range === null) return '时间待定';
  return range.start === range.end
    ? formatSelectedDate(range.start)
    : `${formatSelectedDate(range.start)}—${formatSelectedDate(range.end)}`;
}
