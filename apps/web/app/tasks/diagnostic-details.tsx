'use client';

import type { WebAgentRunDetail, WebAgentRunSummary, WebTask } from '@jobhunter/application/web';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  labelStatus,
  agentRunStatusLabels,
  taskTypeLabels,
  taskStatusLabels,
} from '../components/status-labels.js';
import { TaskActions } from './task-actions.js';
import { TruncatedText } from '../components/truncated-text.js';
import dataTableStyles from '../components/data-table.module.css';
import styles from './diagnostic-details.module.css';

function time(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
        new Date(value),
      )
    : '—';
}

function DialogShell({
  title,
  children,
  onClose,
  returnFocusTo,
}: Readonly<{
  title: string;
  children: ReactElement;
  onClose: () => void;
  returnFocusTo: HTMLButtonElement | null;
}>): ReactElement {
  const dialogReference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogReference.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogReference}
      className={styles.dialog}
      aria-labelledby="diagnostic-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="diagnostic-dialog-title">{title}</h2>
        <button type="button" className="button-muted" onClick={onClose} autoFocus>
          关闭
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function TaskDetailsDialog({ task }: Readonly<{ task: WebTask }>): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerReference = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerReference}
        type="button"
        className={['button-link', styles.trigger].filter(Boolean).join(' ')}
        onClick={() => {
          setOpen(true);
        }}
      >
        {taskTypeLabels[task.taskType] ?? task.taskType}
      </button>
      {open ? (
        <DialogShell
          title="任务详情"
          returnFocusTo={triggerReference.current}
          onClose={() => {
            setOpen(false);
          }}
        >
          <div className={styles.body}>
            <dl className="facts">
              <div>
                <dt>任务类型</dt>
                <dd>
                  {taskTypeLabels[task.taskType] ?? task.taskType}
                  <small>
                    <code>{task.taskType}</code>
                  </small>
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status status-${task.status}`}>
                    {labelStatus(taskStatusLabels, task.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>任务 ID</dt>
                <dd>
                  <code>{task.id}</code>
                </dd>
              </div>
              <div>
                <dt>尝试次数</dt>
                <dd>
                  {task.attemptCount} / {task.maxAttempts}
                </dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{time(task.createdAt)}</dd>
              </div>
              <div>
                <dt>开始 / 完成</dt>
                <dd>
                  {time(task.startedAt)} / {time(task.finishedAt)}
                </dd>
              </div>
            </dl>
            {task.status === 'failed' ? (
              <section className={styles.failureDetail} aria-labelledby="task-failure-heading">
                <h3 id="task-failure-heading">失败原因</h3>
                <p>
                  <strong>{task.errorCategory ?? '未分类'}</strong>
                </p>
                <p>{task.errorSummary ?? '系统未记录可展示的失败原因。'}</p>
              </section>
            ) : null}
            <TaskActions taskId={task.id} status={task.status} />
          </div>
        </DialogShell>
      ) : null}
    </>
  );
}

export function AgentRunDetailsDialog({
  run,
}: Readonly<{ run: WebAgentRunSummary }>): ReactElement {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WebAgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerReference = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || detail) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/agent-runs/${run.id}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as {
          data?: WebAgentRunDetail;
          error?: { message?: string };
        };
        if (!response.ok || !body.data)
          throw new Error(body.error?.message ?? 'Agent 运行详情加载失败。');
        setDetail(body.data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Agent 运行详情加载失败。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [detail, open, run.id]);

  return (
    <>
      <button
        ref={triggerReference}
        type="button"
        className={['button-link', styles.trigger].filter(Boolean).join(' ')}
        onClick={() => {
          setOpen(true);
        }}
      >
        {run.agentKey}
      </button>
      {open ? (
        <DialogShell
          title="Agent 运行详情"
          returnFocusTo={triggerReference.current}
          onClose={() => {
            setOpen(false);
          }}
        >
          <div className={styles.body}>
            <dl className="facts">
              <div>
                <dt>Agent</dt>
                <dd>{run.agentKey}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status status-${run.status}`}>
                    {labelStatus(agentRunStatusLabels, run.status)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>
                  Agent {run.agentVersion} / Prompt {run.promptVersion}
                </dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>
                  {time(run.startedAt)} / {time(run.finishedAt)}
                </dd>
              </div>
              <div>
                <dt>输入 / 输出 Token</dt>
                <dd>
                  {run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}
                </dd>
              </div>
            </dl>
            {run.status === 'failed' ? (
              <section className={styles.failureDetail} aria-labelledby="agent-failure-heading">
                <h3 id="agent-failure-heading">失败原因</h3>
                <p>
                  <strong>{run.errorCategory ?? '未分类'}</strong>
                </p>
                <p>{run.errorSummary ?? '系统未记录可展示的失败原因。'}</p>
              </section>
            ) : null}
            {loading ? <p className="muted">正在加载工具调用……</p> : null}
            {error ? <p className="risk">{error}</p> : null}
            {detail && detail.toolCalls.length > 0 ? (
              <div className={dataTableStyles.scroll}>
                <table>
                  <caption>工具调用</caption>
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>工具</th>
                      <th>状态</th>
                      <th>错误</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.toolCalls.map((call) => (
                      <tr key={call.sequenceNumber}>
                        <td>{call.sequenceNumber}</td>
                        <td>
                          <TruncatedText value={call.toolKey} />
                        </td>
                        <td>{labelStatus(taskStatusLabels, call.status)}</td>
                        <td>
                          <TruncatedText value={call.errorSummary ?? '—'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </DialogShell>
      ) : null}
    </>
  );
}
