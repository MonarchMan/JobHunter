import { describe, expect, it } from 'vitest';
import { taskTimeRange } from '../src/server/task-time-range.js';

describe('任务诊断时间范围', () => {
  const now = Date.parse('2026-11-08T04:00:00Z');
  const midnight = Date.parse('2026-11-07T16:00:00Z');
  it.each([undefined, null, '', 'invalid'])('缺失或非法范围 %s 默认当天', (value) => {
    expect(taskTimeRange(value, now)).toEqual({
      range: 'today',
      since: midnight,
      before: midnight + 86_400_000,
    });
  });
  it.each([
    ['today', 1],
    ['7d', 7],
    ['30d', 30],
  ] as const)('%s 包含当天并按自然日回溯', (range, days) => {
    expect(taskTimeRange(range, now)).toEqual({
      range,
      since: midnight - (days - 1) * 86_400_000,
      before: midnight + 86_400_000,
    });
  });
  it('北京时间午夜切日，不能使用 UTC 午夜', () => {
    expect(taskTimeRange('today', midnight - 1).since).toBe(midnight - 86_400_000);
    expect(taskTimeRange('today', midnight).since).toBe(midnight);
    expect(taskTimeRange('all', now)).toEqual({ range: 'all' });
  });
});
