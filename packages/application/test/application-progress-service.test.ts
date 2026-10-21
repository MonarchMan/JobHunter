import { describe, expect, it } from 'vitest';
import {
  ApplicationProgressQueryService,
  type ApplicationProgressRecord,
  type ApplicationProgressRepository,
} from '../src/applications/index.js';

class MemoryProgressRepository implements ApplicationProgressRepository {
  public constructor(private readonly records: readonly ApplicationProgressRecord[]) {}

  public listApplicationProgress(): readonly ApplicationProgressRecord[] {
    return this.records;
  }
}

const schedule = (
  start: number,
  label: string,
): ApplicationProgressRecord['events'][number]['schedule'] => ({
  activityType: 'interview' as const,
  scheduledStartAt: start,
  scheduledEndAt: start + 45 * 60_000,
  deadlineAt: null,
  scheduledStartLocalDate: null,
  scheduledEndLocalDate: null,
  deadlineLocalDate: null,
  previousScheduledStartAt: null,
  previousScheduledStartLocalDate: null,
  timePrecision: 'exact_time' as const,
  timezoneSource: 'explicit' as const,
  timezoneText: 'Asia/Shanghai',
  stageLabel: label,
});

function record(
  id: string,
  roleTitle: string,
  events: ApplicationProgressRecord['events'],
): ApplicationProgressRecord {
  return {
    id,
    companyId: 'company-1',
    jobId: null,
    companyName: '示例科技',
    roleTitle,
    status: 'interview',
    statusEffectiveAt: events.at(-1)?.effectiveAt ?? null,
    updatedAt: events.at(-1)?.receivedAt ?? 0,
    events,
  };
}

function event(
  id: string,
  eventType: ApplicationProgressRecord['events'][number]['eventType'],
  effectiveAt: number,
  scheduleValue: ApplicationProgressRecord['events'][number]['schedule'] = null,
): ApplicationProgressRecord['events'][number] {
  return {
    id,
    eventType,
    effectiveAt,
    receivedAt: effectiveAt + 1,
    confidence: 0.95,
    schedule: scheduleValue,
    stageLabel: scheduleValue?.stageLabel ?? null,
    location: null,
    meetingUrl: null,
    actionUrl: null,
    sourceUrl: null,
  };
}

describe('ApplicationProgressQueryService', () => {
  it('groups applications by company while keeping roles independent', () => {
    const service = new ApplicationProgressQueryService(
      new MemoryProgressRepository([
        record('app-1', '后端工程师', [event('e-1', 'application_acknowledged', 1)]),
        record('app-2', '数据工程师', [event('e-2', 'assessment_invited', 2)]),
      ]),
      { now: () => 10 },
    );

    const [company] = service.list();
    expect(company?.companyName).toBe('示例科技');
    expect(company?.totalApplications).toBe(2);
    expect(company?.applications.map((item) => item.roleTitle)).toEqual([
      '数据工程师',
      '后端工程师',
    ]);
  });

  it('derives labeled interview rounds and marks completed schedules', () => {
    const service = new ApplicationProgressQueryService(
      new MemoryProgressRepository([
        record('app-1', '后端工程师', [
          event('e-1', 'interview_invited', 1, schedule(2, '一面')),
          event('e-2', 'interview_invited', 3, schedule(20_000_000, '二面')),
        ]),
      ]),
      { now: () => 3_000_000 },
    );

    const rounds = service.list()[0]?.applications[0]?.rounds;
    expect(rounds?.map((round) => [round.label, round.status])).toEqual([
      ['一面', 'completed'],
      ['二面', 'upcoming'],
    ]);
  });
});
