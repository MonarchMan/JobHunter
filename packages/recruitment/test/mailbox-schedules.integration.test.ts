import { expect, it } from 'vitest';
import { z } from 'zod';
import { SystemIdGenerator, utcInstant } from '@jobhunter/common/domain';
import { HandlerRegistry, ScheduleService } from '@jobhunter/common/tasks';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { openSqliteDatabase } from '@jobhunter/common/persistence/connection';
import { SqliteTaskRepository } from '@jobhunter/common/persistence/tasks';
import type { MailboxConfig } from '@jobhunter/recruitment/mail-contracts';
import { reconcileMailboxSchedules } from '../src/mail/application/mailbox-schedules.js';

it('reconciles live mailbox changes before publishing due occurrences', async () => {
  const root = await createTemporaryDataRoot('mailbox-schedules-');
  const database = openSqliteDatabase({ dataRoot: root.path });
  try {
    const ids = new SystemIdGenerator();
    let now = utcInstant(Date.parse('2026-11-10T00:00:00Z'));
    const queue = new SqliteTaskRepository(database.client);
    const registry = new HandlerRegistry();
    registry.register({
      taskType: 'mailbox.sync@v1',
      payloadSchema: z.object({ mailboxKey: z.string() }),
      outputSchema: z.void(),
      defaultMaxAttempts: 4,
      leaseDurationMs: 1000,
      execute: () => Promise.resolve(),
    });
    const schedules = new ScheduleService({ queue, ids, clock: { now: () => now } }, registry);
    const mailbox: MailboxConfig = {
      mailboxKey: 'first',
      providerKey: 'imap',
      maskedAddress: 't***@example.test',
      credentialRef: 'synthetic',
      folders: ['INBOX'],
      initialLookbackDays: 30,
      enabled: true,
    };
    let configs: readonly MailboxConfig[] = [mailbox];
    const dispose = schedules.registerReconciler(() => {
      reconcileMailboxSchedules({ configs, schedules, createId: () => ids.generate() });
    });
    expect(schedules.enqueueDue()).toEqual([]);
    const first = schedules.list('mailbox.sync:')[0];
    if (!first) throw new Error('Missing schedule');
    schedules.enqueueDue();
    expect(schedules.list('mailbox.sync:')[0]?.nextRunAt).toBe(first.nextRunAt);
    now = first.nextRunAt;
    configs = [
      { ...mailbox, enabled: false },
      { ...mailbox, mailboxKey: 'second' },
    ];
    expect(schedules.enqueueDue()).toEqual([]);
    expect(
      schedules.list('mailbox.sync:').find((item) => item.scheduleKey.endsWith('first'))?.enabled,
    ).toBe(false);
    const second = schedules
      .list('mailbox.sync:')
      .find((item) => item.scheduleKey.endsWith('second'));
    if (!second) throw new Error('Missing new mailbox schedule');
    now = second.nextRunAt;
    const published = schedules.enqueueDue();
    expect(published).toHaveLength(1);
    expect(published[0]?.task.payload).toEqual({ mailboxKey: 'second' });
    now = utcInstant(now + 86_400_000);
    configs = [];
    expect(schedules.enqueueDue()).toEqual([]);
    expect(schedules.list('mailbox.sync:').every((item) => !item.enabled)).toBe(true);
    configs = [mailbox];
    schedules.enqueueDue();
    expect(
      schedules.list('mailbox.sync:').find((item) => item.scheduleKey.endsWith('first'))?.id,
    ).toBe(first.id);
    dispose();
  } finally {
    database.close();
    await root.cleanup();
  }
});
