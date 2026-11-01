import { expect, it } from 'vitest';
import type { WebSourceSyncTaskDetail } from '@jobhunter/recruitment/contracts/web';
import { taskPresentation } from '../app/tasks/task-presentation.js';

/** 构造部分同步结果，覆盖正常结束但业务部分完成的场景。 */
const source: WebSourceSyncTaskDetail = {
  companyName: '测试公司',
  channel: 'intern',
  sourceSlug: 'test-source',
  adapterKey: 'test.source',
  trigger: 'manual',
  run: {
    id: 'run',
    status: 'partial',
    coverage: 'partial',
    errorCategory: null,
    errorSummary: '第二页获取失败',
    stats: {
      discovered: 10,
      created: 10,
      revised: 0,
      unchanged: 0,
      skippedNonDomestic: 0,
      skippedOutOfScope: 0,
      skippedUnknownRegion: 0,
      isolated: 0,
      restored: 0,
      staled: 0,
      closed: 0,
      followupEnqueued: 0,
    },
  },
};

it('将正常结束的部分同步显示为警告并保留具体原因', () => {
  expect(
    taskPresentation({ status: 'succeeded', sourceSync: source, errorSummary: null }),
  ).toMatchObject({ label: '警告', status: 'warning', error: '第二页获取失败' });
});

it('不将运行中或失败任务误标为完成或警告', () => {
  for (const status of ['pending', 'running', 'failed', 'cancelled'] as const) {
    expect(taskPresentation({ status, sourceSync: source, errorSummary: null })).toMatchObject({
      status,
      warning: false,
    });
  }
  expect(
    taskPresentation({ status: 'succeeded', sourceSync: null, errorSummary: null }).label,
  ).toBe('完成');
});

it('聚合任务检查每个来源，并为无摘要的部分结果提供提示', () => {
  if (!source.run) throw new Error('Missing fixture run');
  const incomplete = {
    ...source,
    sourceSlug: 'other',
    run: { ...source.run, errorSummary: null },
  };
  const result = taskPresentation({
    status: 'succeeded',
    sourceSync: { ...source, run: null, sources: [source, incomplete] },
    errorSummary: null,
  });
  expect(result.warning).toBe(true);
  expect(result.error).toContain('test-source：第二页获取失败');
  expect(result.error).toContain('other：同步未完整完成');
});
