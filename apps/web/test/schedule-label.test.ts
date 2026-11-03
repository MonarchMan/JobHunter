import { expect, it } from 'vitest';
import { scheduleLabel } from '../app/sources/schedule-label.js';
import { syncStatLabels } from '../app/components/status-labels.js';
import { parseSchedule, scheduleExpression } from '../app/sources/schedule-model.js';

it('将常见同步时间转换为中文并保留复杂周期的明确提示', () => {
  expect(scheduleLabel('0 3 * * *')).toBe('每天 03:00');
  expect(scheduleLabel('30 9 * * 1-5')).toBe('每周一至周五 09:30');
  expect(scheduleLabel('15 * * * *')).toBe('每小时第 15 分钟');
  expect(scheduleLabel('0 9 * * 1,3,5')).toBe('每周一、三、五 09:00');
  expect(scheduleLabel('0 9 1 * *')).toBe('自定义周期');
  expect(scheduleLabel('invalid')).toBe('自定义周期');
  expect(syncStatLabels.discovered).toBe('发现');
  expect(syncStatLabels.restored).toBe('恢复');
});

it('无损往返常用计划并保留复杂 cron，不允许空星期或不均匀小时周期', () => {
  for (const expression of ['0 3 * * *', '30 9 * * 1,3,5', '15 */6 * * *', '0 9 1 * *']) {
    expect(scheduleExpression(parseSchedule(expression))).toBe(expression);
  }
  expect(scheduleExpression(parseSchedule('0 9 * * 1-5'))).toBe('0 9 * * 1-5');
  expect(() => scheduleExpression({ ...parseSchedule('0 9 * * 1'), weekdays: [] })).toThrow(
    '至少选择一天',
  );
  expect(() => scheduleExpression({ ...parseSchedule('0 * * * *'), hours: 5 })).toThrow();
  expect(scheduleLabel('15 */6 * * *')).toBe('每 6 小时（第 15 分钟）');
});
