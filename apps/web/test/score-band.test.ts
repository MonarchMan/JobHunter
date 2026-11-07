import { describe, expect, it } from 'vitest';
import { scoreBand } from '../app/jobs/score-band.js';

describe('职位契合度展示档位', () => {
  it.each([
    [0, 'low'],
    [39.9, 'low'],
    [40, 'partial'],
    [59.9, 'partial'],
    [60, 'good'],
    [79.9, 'good'],
    [80, 'high'],
    [100, 'high'],
  ] as const)('按原始分数 %s 划分为 %s，不受显示舍入影响', (score, key) => {
    expect(scoreBand(score).key).toBe(key);
  });

  it('缺少评分保留未知，不能作为低契合', () => {
    expect(scoreBand(null)).toEqual({ key: 'unknown', label: '未评分' });
  });
});
