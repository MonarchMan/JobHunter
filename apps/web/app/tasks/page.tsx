import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { TaskActions } from './task-actions.js';

export const dynamic = 'force-dynamic';

function time(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
        new Date(value),
      )
    : '—';
}

export default async function TasksPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  const diagnostics = container.services.diagnostics.list();
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>任务与 Agent 运行</h1>
        </div>
        <p>活动任务每 3 秒刷新。诊断视图不会显示任务载荷或模型原始内容。</p>
      </div>

      <section className="panel table-panel" aria-labelledby="task-heading">
        <h2 id="task-heading">后台任务</h2>
        <div className="table-scroll">
          <table>
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
                  <td className="table-empty" colSpan={6}>
                    <strong>暂无后台任务</strong>
                    <span>来源同步、健康检查或其他操作开始后，任务会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <code>{task.taskType}</code>
                      <small>{task.id}</small>
                    </td>
                    <td>
                      <span className={`status status-${task.status}`}>{task.status}</span>
                      {task.cancelRequested ? <small>等待 Worker 取消</small> : null}
                    </td>
                    <td>
                      {task.attemptCount} / {task.maxAttempts}
                    </td>
                    <td>
                      {task.errorCategory
                        ? `${task.errorCategory}: ${task.errorSummary ?? '无错误摘要'}`
                        : '—'}
                    </td>
                    <td>
                      {time(task.startedAt)}
                      <small>{time(task.finishedAt)}</small>
                    </td>
                    <td>
                      <TaskActions taskId={task.id} status={task.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel" aria-labelledby="agent-heading">
        <h2 id="agent-heading">Agent 运行</h2>
        <div className="table-scroll">
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
                  <td className="table-empty" colSpan={6}>
                    <strong>暂无 Agent 运行记录</strong>
                    <span>简历提取、匹配或建议生成后，运行记录会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.agentRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a href={`/agent-runs/${run.id}`}>{run.agentKey}</a>
                    </td>
                    <td>
                      <span className={`status status-${run.status}`}>{run.status}</span>
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
      </section>
    </main>
  );
}
