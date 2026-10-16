import { utcInstant, type RecruitmentScheduleFact } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import {
  CalendarQueryService,
  WebCalendarQueryService,
  calendarSourceEventSchema,
  type ApplicationCalendarRepository,
  type CalendarSourceEvent,
  type CalendarSourceEventType,
} from '../src/calendar/index.js';

/** 内存日历仓储，用于验证事件投影而不引入数据库行为。 */
class MemoryCalendarRepository implements ApplicationCalendarRepository {
  public constructor(private readonly events: readonly CalendarSourceEvent[]) {}

  public listScheduleEvents(): readonly CalendarSourceEvent[] {
    return this.events;
  }
}

describe('CalendarQueryService', () => {
  it('projects an invitation and maps it to the Web contract', () => {
    const event = calendarEvent({
      id: 'event-invite',
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-20T02:00:00.000Z', '一面'),
    });
    const service = new WebCalendarQueryService(
      new CalendarQueryService(new MemoryCalendarRepository([event])),
      () => Date.parse('2026-10-19T00:00:00.000Z'),
    );

    expect(
      service.list({ dateFrom: '2026-10-20', dateTo: '2026-10-20', timezone: 'Asia/Shanghai' }),
    ).toEqual({
      items: [
        expect.objectContaining({
          id: 'event-invite',
          sourceEventId: 'event-invite',
          activityType: 'interview',
          timingStatus: 'upcoming',
          stageLabel: '一面',
          scheduledStartAt: '2026-10-20T02:00:00.000Z',
        }),
      ],
    });
  });

  it('marks past appointments and deadlines completed', () => {
    const interview = calendarEvent({
      id: 'event-completed',
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-15T02:00:00.000Z', '一面'),
    });
    const assessment = calendarEvent({
      id: 'event-past-deadline',
      sequenceNo: 2,
      eventType: 'assessment_invited',
      schedule: {
        ...emptySchedule('written_exam', '在线笔试'),
        deadlineLocalDate: '2026-10-15',
        timePrecision: 'date_only',
        timezoneSource: 'not_applicable',
      },
    });
    const service = new WebCalendarQueryService(
      new CalendarQueryService(new MemoryCalendarRepository([interview, assessment])),
      () => Date.parse('2026-10-16T04:00:00.000Z'),
    );

    expect(
      service
        .list({ dateFrom: '2026-10-15', dateTo: '2026-10-15', timezone: 'Asia/Shanghai' })
        .items.map((item) => ({ id: item.id, status: item.timingStatus })),
    ).toEqual(
      expect.arrayContaining([
        { id: 'event-completed', status: 'completed' },
        { id: 'event-past-deadline', status: 'completed' },
      ]),
    );
  });

  it('replaces the targeted interview after rescheduling without exposing the old schedule', () => {
    const firstRound = calendarEvent({
      id: 'event-first-round',
      sequenceNo: 1,
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-20T02:00:00.000Z', '一面'),
    });
    const secondRound = calendarEvent({
      id: 'event-second-round',
      sequenceNo: 2,
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-22T02:00:00.000Z', '二面'),
    });
    const rescheduled = calendarEvent({
      id: 'event-rescheduled',
      sequenceNo: 3,
      eventType: 'interview_rescheduled',
      schedule: {
        ...exactSchedule('2026-10-25T02:00:00.000Z', '一面'),
        previousScheduledStartAt: utcInstant(Date.parse('2026-10-20T02:00:00.000Z')),
      },
    });
    const service = new CalendarQueryService(
      new MemoryCalendarRepository([secondRound, rescheduled, firstRound]),
    );

    expect(service.list({ dateFrom: '2026-10-20', dateTo: '2026-10-20', timezone: 'UTC' })).toEqual(
      [],
    );
    expect(service.list({ dateFrom: '2026-10-22', dateTo: '2026-10-25', timezone: 'UTC' })).toEqual(
      [
        expect.objectContaining({ id: 'event-second-round', sourceEventId: 'event-second-round' }),
        expect.objectContaining({ id: 'event-first-round', sourceEventId: 'event-rescheduled' }),
      ],
    );
  });

  it('replays backfilled mail by received time and merges reminders for the rescheduled slot', () => {
    const invited = calendarEvent({
      id: 'event-invited',
      sequenceNo: 3,
      receivedAt: '2026-10-10T01:00:00.000Z',
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-20T02:00:00.000Z', '一面'),
    });
    const rescheduled = calendarEvent({
      id: 'event-rescheduled',
      sequenceNo: 1,
      receivedAt: '2026-10-11T01:00:00.000Z',
      eventType: 'interview_rescheduled',
      schedule: {
        ...exactSchedule('2026-10-21T03:00:00.000Z', '一面'),
        previousScheduledStartAt: utcInstant(Date.parse('2026-10-20T02:00:00.000Z')),
      },
    });
    const reminder = calendarEvent({
      id: 'event-reminder',
      sequenceNo: 2,
      receivedAt: '2026-10-12T01:00:00.000Z',
      eventType: 'interview_invited',
      schedule: {
        ...exactSchedule('2026-10-21T03:00:00.000Z', null),
        scheduledEndAt: utcInstant(Date.parse('2026-10-21T04:00:00.000Z')),
        timePrecision: 'time_range',
      },
    });
    const service = new CalendarQueryService(
      new MemoryCalendarRepository([rescheduled, reminder, invited]),
    );

    expect(service.list({ dateFrom: '2026-10-20', dateTo: '2026-10-20', timezone: 'UTC' })).toEqual(
      [],
    );
    expect(service.list({ dateFrom: '2026-10-21', dateTo: '2026-10-21', timezone: 'UTC' })).toEqual(
      [expect.objectContaining({ id: 'event-invited', sourceEventId: 'event-reminder' })],
    );
  });

  it('removes a cancelled interview instead of returning a cancellation item', () => {
    const invited = calendarEvent({
      id: 'event-invite',
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-10-20T02:00:00.000Z', '技术面'),
    });
    const cancelled = calendarEvent({
      id: 'event-cancelled',
      sequenceNo: 2,
      eventType: 'interview_cancelled',
      schedule: {
        ...emptySchedule('interview', '技术面'),
        previousScheduledStartAt: utcInstant(Date.parse('2026-10-20T02:00:00.000Z')),
      },
    });

    expect(
      new CalendarQueryService(new MemoryCalendarRepository([invited, cancelled])).list({
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        timezone: 'Asia/Shanghai',
      }),
    ).toEqual([]);
  });

  it('queries a date-only assessment without inventing an instant', () => {
    const assessment = calendarEvent({
      id: 'event-assessment',
      eventType: 'assessment_invited',
      schedule: {
        ...emptySchedule('assessment', null),
        deadlineLocalDate: '2026-10-31',
        timePrecision: 'date_only',
        timezoneSource: 'not_applicable',
      },
    });
    const service = new CalendarQueryService(new MemoryCalendarRepository([assessment]));

    expect(
      service.list({ dateFrom: '2026-10-31', dateTo: '2026-10-31', timezone: 'Asia/Shanghai' }),
    ).toHaveLength(1);
    expect(
      service.list({ dateFrom: '2026-11-01', dateTo: '2026-11-01', timezone: 'Asia/Shanghai' }),
    ).toEqual([]);
  });

  it('uses IANA timezone boundaries across daylight saving changes', () => {
    const beforeLocalMidnight = calendarEvent({
      id: 'event-before-midnight',
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-03-09T03:59:00.000Z', null),
    });
    const atNextLocalMidnight = calendarEvent({
      id: 'event-next-day',
      sequenceNo: 2,
      eventType: 'interview_invited',
      schedule: exactSchedule('2026-03-09T04:00:00.000Z', null),
    });
    const service = new CalendarQueryService(
      new MemoryCalendarRepository([beforeLocalMidnight, atNextLocalMidnight]),
    );

    expect(
      service
        .list({ dateFrom: '2026-03-08', dateTo: '2026-03-08', timezone: 'America/New_York' })
        .map((item) => item.id),
    ).toEqual(['event-before-midnight']);
  });
});

/** 创建通过 Repository 边界校验的测试事件。 */
function calendarEvent(input: {
  readonly id: string;
  readonly sequenceNo?: number;
  readonly receivedAt?: string;
  readonly eventType: CalendarSourceEventType;
  readonly schedule: RecruitmentScheduleFact;
}): CalendarSourceEvent {
  return calendarSourceEventSchema.parse({
    id: input.id,
    applicationId: 'application-1',
    sequenceNo: input.sequenceNo ?? 1,
    companyName: '示例公司',
    roleTitle: '后端工程师',
    eventType: input.eventType,
    effectiveAt: Date.parse('2026-10-15T00:00:00.000Z'),
    receivedAt: Date.parse(input.receivedAt ?? '2026-10-15T00:00:00.000Z'),
    schedule: input.schedule,
    location: null,
    meetingUrl: null,
    actionUrl: null,
  });
}

/** 构造包含精确开始时间的面试安排。 */
function exactSchedule(iso: string, stageLabel: string | null): RecruitmentScheduleFact {
  return {
    ...emptySchedule('interview', stageLabel),
    scheduledStartAt: utcInstant(Date.parse(iso)),
    timePrecision: 'exact_time',
    timezoneSource: 'explicit',
    timezoneText: '测试时区',
  };
}

/** 构造不带时间的完整日程结构，调用方只覆盖测试相关字段。 */
function emptySchedule(
  activityType: RecruitmentScheduleFact['activityType'],
  stageLabel: string | null,
): RecruitmentScheduleFact {
  return {
    activityType,
    scheduledStartAt: null,
    scheduledEndAt: null,
    deadlineAt: null,
    scheduledStartLocalDate: null,
    scheduledEndLocalDate: null,
    deadlineLocalDate: null,
    previousScheduledStartAt: null,
    previousScheduledStartLocalDate: null,
    timePrecision: 'unknown',
    timezoneSource: 'unknown',
    timezoneText: null,
    stageLabel,
  };
}
