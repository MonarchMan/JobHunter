import type { WebTask } from '@jobhunter/recruitment/contracts/web';
import { labelStatus, taskStatusLabels } from '../components/status-labels.js';

/** 保留调度中的状态；完成后结合所有来源结果显示警告，并汇总可展示的错误。 */
export function taskPresentation(
  task: Pick<WebTask, 'status' | 'sourceSync' | 'errorSummary'> &
    Partial<Pick<WebTask, 'errorCategory'>>,
): {
  label: string;
  status: string;
  error: string;
  warning: boolean;
  errorCategory: string | null;
} {
  const sources = task.sourceSync?.sources?.length
    ? task.sourceSync.sources
    : task.sourceSync
      ? [task.sourceSync]
      : [];
  const runs = sources.flatMap((source) => (source.run ? [source.run] : []));
  /** 只有已结束的运行才能判定覆盖不完整，执行中 unknown 是正常初始值。 */
  const incomplete = (run: (typeof runs)[number]): boolean =>
    run.status !== 'running' &&
    (run.status === 'partial' || run.status === 'failed' || run.coverage !== 'complete');
  // 1、任务结束后再汇总来源警告，运行中的未知覆盖不算异常。
  const warning = task.status === 'succeeded' && runs.some(incomplete);
  // 2、保留真实摘要；仅已结束且不完整的来源生成兜底提示。
  const errors = [
    task.errorSummary
      ?.replace(/^同步已提交；(?=评分 \d+\/\d+ 完成。)/u, '')
      .replace(
        /^(评分 \d+\/\d+ 完成。)职位分析 is temporarily unavailable\.$/u,
        '$1职位分析暂时无法完成。',
      ),
    ...sources.map((source) => {
      if (!source.run) return null;
      const reason =
        source.run.errorSummary ??
        (incomplete(source.run) ? '同步未完整完成，系统未记录具体错误原因。' : null);
      return reason && sources.length > 1 ? `${source.sourceSlug}：${reason}` : reason;
    }),
  ].filter((value): value is string => Boolean(value));
  return {
    label: warning
      ? '警告'
      : task.status === 'succeeded'
        ? '完成'
        : labelStatus(taskStatusLabels, task.status),
    status: warning ? 'warning' : task.status,
    error: [...new Set(errors)].join('；'),
    warning,
    errorCategory:
      task.errorCategory ??
      ([
        ...new Set(
          runs.map((run) => run.errorCategory).filter((value): value is string => Boolean(value)),
        ),
      ].join('；') ||
        null),
  };
}
