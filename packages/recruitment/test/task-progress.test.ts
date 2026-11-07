import { describe, expect, it } from 'vitest';
import { presentBatchProgress } from '../src/diagnostics/task-progress.js';

describe('批量任务进度投影', () => {
  it('总数来自冻结输入，成功和失败均计入已处理，重复及批次外项目不计入', () => {
    expect(
      presentBatchProgress(
        'match.score-batch',
        { jobRevisionIds: ['a', 'b', 'c'] },
        {
          items: [
            { jobRevisionId: 'a', status: 'succeeded', result: { private: 'secret' } },
            { jobRevisionId: 'b', status: 'failed' },
            { jobRevisionId: 'a', status: 'succeeded' },
            { jobRevisionId: 'outside', status: 'succeeded' },
          ],
        },
      ),
    ).toEqual({ total: 3, processed: 2 });
  });

  it('新批次显示零进度，重试未产生新结果时保留检查点', () => {
    expect(presentBatchProgress('match.score-batch', { jobRevisionIds: ['a'] }, null)).toEqual({
      total: 1,
      processed: 0,
    });
    expect(
      presentBatchProgress(
        'match.score-batch',
        {
          jobRevisionIds: ['a', 'b'],
          progress: { items: [{ jobRevisionId: 'a', status: 'succeeded' }] },
        },
        null,
      ),
    ).toEqual({ total: 2, processed: 1 });
  });

  it('普通任务和无效批次不伪造进度', () => {
    expect(presentBatchProgress('source.sync', {}, null)).toBeNull();
    expect(presentBatchProgress('match.score-batch', { jobRevisionIds: [] }, null)).toBeNull();
    expect(
      presentBatchProgress('match.score-batch', { jobRevisionIds: ['a', 'a'] }, null),
    ).toBeNull();
  });
});
