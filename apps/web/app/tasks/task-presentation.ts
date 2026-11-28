import type { WebTask } from '@jobhunter/recruitment/contracts/web';
import { labelStatus, taskStatusLabels } from '../components/status-labels.js';
import { taskErrorCopy } from './task-error-copy.js';

/** 保留调度中的状态；完成后结合所有来源结果显示警告，并汇总可展示的错误。 */
export function taskPresentation(
  task: Pick<WebTask, 'status' | 'sourceSync' | 'errorSummary'> &
    Partial<Pick<WebTask, 'errorCategory' | 'diagnostic'>>,
): {
  label: string;
  status: string;
  error: string;
  warning: boolean;
  errorCategory: string | null;
  errorTitle: string;
} {
  if (task.status === 'pending') {
    return {
      label: labelStatus(taskStatusLabels, task.status),
      status: task.status,
      error: '',
      warning: false,
      errorCategory: null,
      errorTitle: '',
    };
  }
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
  const primarySummary = task.errorSummary
    ?.replace(/^同步已提交；(?=评分 \d+\/\d+ 完成。)/u, '')
    .replace(
      /^(评分 \d+\/\d+ 完成。)职位分析 is temporarily unavailable\.$/u,
      '$1职位分析暂时无法完成。',
    )
    .replace(/职位分析 output was rejected\.$/u, '职位分析未生成符合要求的结果。');
  const primary = taskErrorCopy(primarySummary, task.errorCategory, warning);
  const errors = [
    task.diagnostic?.message ?? primary.message,
    ...sources.map((source) => {
      if (!source.run) return null;
      const reason =
        taskErrorCopy(source.run.errorSummary, source.run.errorCategory).message ||
        (incomplete(source.run) ? '同步未完整完成，系统未记录具体错误原因。' : null);
      return reason && sources.length > 1 ? `${source.sourceSlug}：${reason}` : reason;
    }),
  ].filter((value): value is string => Boolean(value));
  const issue = runs.find((run) => run.errorSummary || run.errorCategory || incomplete(run));
  return {
    label: warning
      ? '警告'
      : task.status === 'succeeded'
        ? '完成'
        : labelStatus(taskStatusLabels, task.status),
    status: warning ? 'warning' : task.status,
    error: [...new Set(errors)].join('；'),
    warning,
    errorTitle:
      task.diagnostic?.title ??
      (primarySummary || task.errorCategory
        ? primary.title
        : taskErrorCopy(issue?.errorSummary, issue?.errorCategory, task.status === 'succeeded')
            .title),
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
