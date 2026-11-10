import type { ScheduleService } from '@jobhunter/common/tasks';
import type { MailboxConfig } from '@jobhunter/recruitment/mail-contracts';
/** 按当前邮箱配置对账每日计划：删除、禁用与重新启用均原位更新。 */
export function reconcileMailboxSchedules(input: {
  configs: readonly MailboxConfig[];
  schedules: Pick<ScheduleService, 'list' | 'upsert'>;
  createId: () => string;
}): void {
  const existing = new Map(
    input.schedules.list('mailbox.sync:').map((item) => [item.scheduleKey, item]),
  );
  const enabled = new Map(
    input.configs
      .filter((item) => item.enabled)
      .map((item) => ['mailbox.sync:' + item.mailboxKey, item]),
  );
  for (const [key, mailbox] of enabled) {
    const current = existing.get(key);
    if (
      current?.enabled &&
      current.taskType === 'mailbox.sync@v1' &&
      current.cronExpression === '0 3 * * *' &&
      current.timezone === 'Asia/Shanghai' &&
      (current.payload as { mailboxKey?: string }).mailboxKey === mailbox.mailboxKey
    )
      continue;
    input.schedules.upsert({
      id: current?.id ?? input.createId(),
      scheduleKey: key,
      taskType: 'mailbox.sync@v1',
      payload: { mailboxKey: mailbox.mailboxKey },
      cronExpression: '0 3 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
    });
  }
  for (const [key, current] of existing)
    if (current.enabled && !enabled.has(key))
      input.schedules.upsert({ ...current, enabled: false });
}
