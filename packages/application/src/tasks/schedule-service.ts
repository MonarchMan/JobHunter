import { CronExpressionParser } from 'cron-parser';
import { parseId, utcInstant, type UtcInstant } from '@jobhunter/domain';
import type { HandlerRegistry } from './handler-registry.js';
import type {
  EnqueueTaskResult,
  PersistedScheduleInput,
  ScheduleRecord,
  TaskRuntimeDependencies,
} from './model.js';

export interface UpsertScheduleCommand {
  readonly id: string;
  readonly scheduleKey: string;
  readonly taskType: string;
  readonly payload: unknown;
  readonly cronExpression: string;
  readonly timezone?: string;
  readonly enabled?: boolean;
}

function nextOccurrence(cronExpression: string, timezone: string, after: number): UtcInstant {
  const expression = CronExpressionParser.parse(cronExpression, {
    currentDate: new Date(after),
    tz: timezone,
  });
  return utcInstant(expression.next().getTime());
}

function latestOccurrence(
  cronExpression: string,
  timezone: string,
  storedNext: UtcInstant,
  now: UtcInstant,
): UtcInstant {
  const expression = CronExpressionParser.parse(cronExpression, {
    currentDate: new Date(now + 1),
    tz: timezone,
  });
  const latest = utcInstant(expression.prev().getTime());
  return latest < storedNext ? storedNext : latest;
}

export class ScheduleService {
  readonly #dependencies: TaskRuntimeDependencies;
  readonly #registry: HandlerRegistry;

  public constructor(dependencies: TaskRuntimeDependencies, registry: HandlerRegistry) {
    this.#dependencies = dependencies;
    this.#registry = registry;
  }

  public upsert(command: UpsertScheduleCommand): ScheduleRecord {
    const handler = this.#registry.get(command.taskType);
    const payload = handler.payloadSchema.parse(command.payload);
    const scheduleKey = command.scheduleKey.trim();
    const timezone = command.timezone ?? 'Asia/Shanghai';
    if (!scheduleKey) throw new TypeError('Schedule key must not be empty.');
    const now = this.#dependencies.clock.now();
    const input: PersistedScheduleInput = {
      id: parseId(command.id, 'Schedule'),
      scheduleKey,
      taskType: command.taskType,
      payload,
      cronExpression: command.cronExpression,
      timezone,
      enabled: command.enabled ?? true,
      nextRunAt: nextOccurrence(command.cronExpression, timezone, now),
      now,
    };
    return this.#dependencies.queue.upsertSchedule(input);
  }

  public enqueueDue(limit = 100): readonly EnqueueTaskResult[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError('Schedule polling limit is invalid.');
    }
    const now = this.#dependencies.clock.now();
    const results: EnqueueTaskResult[] = [];
    for (const schedule of this.#dependencies.queue.dueSchedules(now, limit)) {
      const handler = this.#registry.get(schedule.taskType);
      const payload = handler.payloadSchema.parse(schedule.payload);
      const occurrenceAt = latestOccurrence(
        schedule.cronExpression,
        schedule.timezone,
        schedule.nextRunAt,
        now,
      );
      const following = nextOccurrence(schedule.cronExpression, schedule.timezone, now);
      const result = this.#dependencies.queue.commitScheduleOccurrence({
        scheduleId: schedule.id,
        expectedNextRunAt: schedule.nextRunAt,
        occurrenceAt,
        nextRunAt: following,
        now,
        task: {
          id: parseId(this.#dependencies.ids.generate(), 'Task'),
          taskType: schedule.taskType,
          payload,
          priority: 0,
          idempotencyKey: `schedule:${schedule.scheduleKey}:${String(occurrenceAt)}`,
          concurrencyKey: handler.concurrencyKey?.(payload) ?? null,
          scheduleId: schedule.id,
          retryOfTaskId: null,
          maxAttempts: handler.defaultMaxAttempts,
          availableAt: now,
          createdAt: now,
        },
      });
      if (result) results.push(result);
    }
    return results;
  }
}
