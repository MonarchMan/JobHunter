import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  agentRunStatusLabels,
  labelStatus,
  taskTypeLabels,
  taskStatusLabels,
} from '../components/status-labels.js';
import { PageHeader } from '../components/page-header.js';
import { TruncatedText } from '../components/truncated-text.js';
import { Pagination } from '../components/pagination.js';
import { getWebContainer } from '../../src/server/container.js';
import {
  firstSearchParameter,
  pageHref,
  type SearchParameterSource,
} from '../../src/server/job-query.js';
import { TaskActions } from './task-actions.js';
import { TaskAutoRefresh } from './task-auto-refresh.js';
import { AgentRunDetailsDialog, TaskDetailsDialog } from './diagnostic-details.js';
import { SelectField } from '../components/select-field.js';
import dataTableStyles from '../components/data-table.module.css';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '任务与 Agent 运行' };

function time(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
        new Date(value),
      )
    : '—';
}

function positivePage(source: SearchParameterSource, name: string): number {
  const value = Number(firstSearchParameter(source, name) ?? '1');
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

interface TasksPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

export default async function TasksPage({
  searchParams,
}: TasksPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const status = firstSearchParameter(parameters, 'status');
  const taskType = firstSearchParameter(parameters, 'type');
  const taskPage = positivePage(parameters, 'taskPage');
  const agentPage = positivePage(parameters, 'agentPage');
  const container = await getWebContainer();
  const diagnostics = container.services.diagnostics.list({
    ...(status && ['pending', 'running', 'failed', 'succeeded', 'cancelled'].includes(status)
      ? { status: status as 'pending' | 'running' | 'failed' | 'succeeded' | 'cancelled' }
      : {}),
    ...(taskType ? { taskType } : {}),
    taskPage,
    agentPage,
  });
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="任务与 Agent 运行">
        <div>
          <p>诊断视图不会显示任务载荷或模型原始内容。</p>
          <TaskAutoRefresh />
        </div>
      </PageHeader>

      <form
        className={styles.filters}
        action="/tasks"
        method="get"
        aria-label="任务筛选"
        noValidate
      >
        <label>
          状态
          <SelectField
            name="status"
            label="状态"
            defaultValue={status ?? ''}
            options={[
              { value: '', label: '全部状态' },
              { value: 'pending', label: '待处理' },
              { value: 'running', label: '运行中' },
              { value: 'failed', label: '失败' },
              { value: 'succeeded', label: '已完成' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
        </label>
        <label>
          类型
          <SelectField
            name="type"
            label="类型"
            defaultValue={taskType ?? ''}
            options={[
              { value: '', label: '全部类型' },
              ...Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </label>
        <button type="submit">应用筛选</button>
        <a className="button-secondary" href="/tasks">
          清除
        </a>
      </form>

      <section
        className={['panel', dataTableStyles.panel].filter(Boolean).join(' ')}
        aria-labelledby="task-heading"
        data-task-section
      >
        <h2 id="task-heading">后台任务</h2>
        <div
          className={[dataTableStyles.scroll, styles.desktopTable].filter(Boolean).join(' ')}
          data-task-table
        >
          <table className={styles.taskTable}>
            <caption className="sr-only">后台任务列表</caption>
            <thead>
              <tr>
                <th scope="col">类型</th>
                <th scope="col">状态</th>
                <th scope="col">尝试</th>
                <th scope="col">错误</th>
                <th scope="col">开始 / 完成</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.tasks.length === 0 ? (
                <tr key="empty-tasks">
                  <td className={dataTableStyles.empty} colSpan={6}>
                    <strong>暂无后台任务</strong>
                    <span>来源同步、健康检查或其他操作开始后，任务会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>
                        <TaskDetailsDialog task={task} />
                      </strong>
                      <small>
                        {task.jobDetailBatch
                          ? `成功 ${String(task.jobDetailBatch.counts.succeeded)} / ${String(task.jobDetailBatch.counts.total)}`
                          : (taskTypeLabels[task.taskType] ?? task.taskType)}
                      </small>
                      <small>
                        <code>{task.id.slice(0, 8)}…</code>
                      </small>
                    </td>
                    <td>
                      <span className={`status status-${task.status}`}>
                        {labelStatus(taskStatusLabels, task.status)}
                      </span>
                      {task.cancelRequested ? <small>等待 Worker 取消</small> : null}
                    </td>
                    <td>
                      {task.jobDetailBatch
                        ? `${String(task.jobDetailBatch.counts.succeeded)} / ${String(task.jobDetailBatch.counts.total)}`
                        : `${String(task.attemptCount)} / ${String(task.maxAttempts)}`}
                    </td>
                    <td>
                      <TruncatedText
                        value={
                          task.errorCategory
                            ? `${task.errorCategory}: ${task.errorSummary ?? '无错误摘要'}`
                            : '—'
                        }
                      />
                    </td>
                    <td>
                      {time(task.startedAt)}
                      <small>{time(task.finishedAt)}</small>
                    </td>
                    <td>
                      {task.kind === 'task' ? (
                        <TaskActions taskId={task.id} status={task.status} />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.cards} aria-label="后台任务卡片列表" data-task-cards>
          {diagnostics.tasks.map((task) => (
            <article className={styles.card} key={task.id}>
              <div className={styles.cardHeading}>
                <strong>
                  <TaskDetailsDialog task={task} />
                </strong>
                <span className={`status status-${task.status}`}>
                  {labelStatus(taskStatusLabels, task.status)}
                </span>
              </div>
              <code>{task.id.slice(0, 8)}…</code>
              <p>
                {task.errorCategory
                  ? `${task.errorCategory}: ${task.errorSummary ?? '无错误摘要'}`
                  : '暂无错误'}
              </p>
              {task.jobDetailBatch ? (
                <p>
                  总数 {String(task.jobDetailBatch.counts.total)}，成功{' '}
                  {String(task.jobDetailBatch.counts.succeeded)}，失败{' '}
                  {String(task.jobDetailBatch.counts.failed)}
                </p>
              ) : null}
              {task.kind === 'task' ? <TaskActions taskId={task.id} status={task.status} /> : null}
            </article>
          ))}
        </div>
        <Pagination
          currentPage={diagnostics.taskPagination.current}
          totalPages={diagnostics.taskPagination.totalPages}
          label="后台任务分页"
          createHref={(page) => `/tasks${pageHref(parameters, 'taskPage', page)}`}
        />
      </section>

      <section
        className={['panel', dataTableStyles.panel].filter(Boolean).join(' ')}
        aria-labelledby="agent-heading"
        data-agent-section
      >
        <h2 id="agent-heading">Agent 运行</h2>
        <div
          className={[dataTableStyles.scroll, styles.desktopTable].filter(Boolean).join(' ')}
          data-agent-table
        >
          <table>
            <caption className="sr-only">Agent 运行列表</caption>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">状态</th>
                <th scope="col">版本</th>
                <th scope="col">Token</th>
                <th scope="col">估算成本</th>
                <th scope="col">时间</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.agentRuns.length === 0 ? (
                <tr key="empty-agent-runs">
                  <td className={dataTableStyles.empty} colSpan={6}>
                    <strong>暂无 Agent 运行记录</strong>
                    <span>简历提取、匹配或建议生成后，运行记录会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.agentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <AgentRunDetailsDialog run={run} />
                    </td>
                    <td>
                      <span className={`status status-${run.status}`}>
                        {labelStatus(agentRunStatusLabels, run.status)}
                      </span>
                      {run.errorCategory ? <small>{run.errorCategory}</small> : null}
                    </td>
                    <td>
                      Agent {run.agentVersion}
                      <small>Prompt {run.promptVersion}</small>
                    </td>
                    <td>
                      {run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}
                    </td>
                    <td>
                      {run.estimatedCostMicros === null
                        ? '—'
                        : `${(run.estimatedCostMicros / 1_000_000).toFixed(6)} ${run.costCurrency ?? ''}`}
                    </td>
                    <td>{time(run.startedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.cards} aria-label="Agent 运行卡片列表" data-agent-cards>
          {diagnostics.agentRuns.map((run) => (
            <article className={styles.card} key={run.id}>
              <div className={styles.cardHeading}>
                <AgentRunDetailsDialog run={run} />
                <span className={`status status-${run.status}`}>
                  {labelStatus(agentRunStatusLabels, run.status)}
                </span>
              </div>
              <p>
                版本 Agent {run.agentVersion} · {time(run.startedAt)}
              </p>
              <small>{run.errorCategory ?? '暂无错误'}</small>
            </article>
          ))}
        </div>
        <Pagination
          currentPage={diagnostics.agentPagination.current}
          totalPages={diagnostics.agentPagination.totalPages}
          label="Agent 运行分页"
          createHref={(page) => `/tasks${pageHref(parameters, 'agentPage', page)}`}
        />
      </section>
    </main>
  );
}
