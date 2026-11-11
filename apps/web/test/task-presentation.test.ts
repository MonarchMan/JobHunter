import { expect, it } from 'vitest';
import type { WebSourceSyncTaskDetail } from '@jobhunter/recruitment/contracts/web';
import { taskPresentation } from '../app/tasks/task-presentation.js';

it('presents a historical sync scoring failure without the old prefix or mixed wording', () => {
  expect(
    taskPresentation({
      status: 'failed',
      sourceSync: null,
      errorSummary: '同步已提交；评分 0/1 完成。职位分析 is temporarily unavailable.',
    }).error,
  ).toBe('评分 0/1 完成。职位分析暂时无法完成。');
});

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

it('运行中的未知覆盖不生成错误或警告，真实摘要仍保留', () => {
  if (!source.run) throw new Error('Missing fixture run');
  const running = {
    ...source,
    run: {
      ...source.run,
      status: 'running' as const,
      coverage: 'unknown' as const,
      errorSummary: null,
    },
  };
  for (const status of ['pending', 'running', 'succeeded'] as const) {
    expect(taskPresentation({ status, sourceSync: running, errorSummary: null })).toMatchObject({
      error: '',
      warning: false,
    });
  }
  expect(
    taskPresentation({ status: 'running', sourceSync: running, errorSummary: '真实错误' }).error,
  ).toBe('真实错误');
  expect(
    taskPresentation({
      status: 'running',
      sourceSync: { ...running, run: { ...running.run, errorSummary: '来源错误' } },
      errorSummary: null,
    }).error,
  ).toBe('来源错误');
  const combined = taskPresentation({
    status: 'running',
    sourceSync: { ...source, run: null, sources: [running, { ...source, sourceSlug: 'finished' }] },
    errorSummary: null,
  });
  expect(combined.error).toBe('finished：第二页获取失败');
});

it('终态且覆盖未知时仍保留不完整提示', () => {
  if (!source.run) throw new Error('Missing fixture run');
  const result = taskPresentation({
    status: 'succeeded',
    errorSummary: null,
    sourceSync: {
      ...source,
      run: { ...source.run, status: 'succeeded', coverage: 'unknown', errorSummary: null },
    },
  });
  expect(result).toMatchObject({
    warning: true,
    error: '同步未完整完成，系统未记录具体错误原因。',
  });
});

it('任务没有错误类别时使用来源警告类别，并优先保留任务自身错误', () => {
  if (!source.run) throw new Error('Missing fixture run');
  const task = {
    status: 'succeeded' as const,
    errorSummary: null,
    sourceSync: { ...source, run: { ...source.run, errorCategory: 'partial_coverage' } },
  };
  expect(taskPresentation(task).errorCategory).toBe('partial_coverage');
  expect(taskPresentation({ ...task, errorCategory: 'network_temporary' }).errorCategory).toBe(
    'network_temporary',
  );
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
