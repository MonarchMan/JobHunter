import type { WebTask } from '@jobhunter/recruitment/contracts/web';
import { labelStatus, taskStatusLabels } from '../components/status-labels.js';

/** 保留调度中的状态；完成后结合所有来源结果显示警告，并汇总可展示的错误。 */
export function taskPresentation(task: Pick<WebTask, 'status' | 'sourceSync' | 'errorSummary'>): {
  label: string;
  status: string;
  error: string;
  warning: boolean;
} {
  const sources = task.sourceSync?.sources?.length
    ? task.sourceSync.sources
    : task.sourceSync
      ? [task.sourceSync]
      : [];
  const runs = sources.flatMap((source) => (source.run ? [source.run] : []));
  const warning =
    task.status === 'succeeded' &&
    runs.some(
      (run) => run.status === 'partial' || run.status === 'failed' || run.coverage !== 'complete',
    );
  const errors = [
    task.errorSummary,
    ...sources.map((source) => {
      if (!source.run) return null;
      const reason =
        source.run.errorSummary ??
        (source.run.status === 'partial' ||
        source.run.status === 'failed' ||
        source.run.coverage !== 'complete'
          ? '同步未完整完成，系统未记录具体错误原因。'
          : null);
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
  };
}
