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

const sourceChannelLabels = { intern: '实习', campus: '校招', social: '社招' } as const;
const sourceTriggerLabels = { manual: '手动', schedule: '定时', retry: '重试' } as const;
const syncRunStatusLabels = {
  running: '运行中',
  succeeded: '成功',
  partial: '退化',
  failed: '失败',
  cancelled: '已取消',
} as const;
const syncCoverageLabels = { complete: '完整', partial: '部分', unknown: '未知' } as const;

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
  const displayName = task.jobDetailBatch
    ? `${task.jobDetailBatch.companyName}职位详情同步`
    : (taskTypeLabels[task.taskType] ?? task.taskType);
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
        {displayName}
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
                  {displayName}
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
                <dt>{task.jobDetailBatch ? '同步批次 ID' : '任务 ID'}</dt>
                <dd>
                  <code>{task.id}</code>
                </dd>
              </div>
              <div>
                <dt>{task.jobDetailBatch ? '成功 / 总数' : '尝试次数'}</dt>
                <dd>
                  {task.jobDetailBatch
                    ? `${String(task.jobDetailBatch.counts.succeeded)} / ${String(task.jobDetailBatch.counts.total)}`
                    : `${String(task.attemptCount)} / ${String(task.maxAttempts)}`}
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
            {task.jobDetailBatch ? (
              <section className={styles.batchDetail} aria-label="职位详情同步统计">
                <dl className="facts">
                  <div>
                    <dt>公司 / 招聘渠道</dt>
                    <dd>
                      {task.jobDetailBatch.companyName} /{' '}
                      {sourceChannelLabels[task.jobDetailBatch.channel]}
                    </dd>
                  </div>
                  <div>
                    <dt>物理来源</dt>
                    <dd>{task.jobDetailBatch.sourceSlug}</dd>
                  </div>
                  <div>
                    <dt>总数</dt>
                    <dd>{task.jobDetailBatch.counts.total}</dd>
                  </div>
                  <div>
                    <dt>等待 / 运行</dt>
                    <dd>
                      {String(task.jobDetailBatch.counts.pending)} /{' '}
                      {String(task.jobDetailBatch.counts.running)}
                    </dd>
                  </div>
                  <div>
                    <dt>成功 / 失败 / 取消</dt>
                    <dd>
                      {[
                        task.jobDetailBatch.counts.succeeded,
                        task.jobDetailBatch.counts.failed,
                        task.jobDetailBatch.counts.cancelled,
                      ]
                        .map(String)
                        .join(' / ')}
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {task.sourceSync ? (
              <section aria-labelledby={`source-sync-detail-${task.id}`}>
                <h3 id={`source-sync-detail-${task.id}`}>官网同步信息</h3>
                <dl className="facts">
                  <div>
                    <dt>公司 / 招聘渠道</dt>
                    <dd>
                      {task.sourceSync.companyName} / {sourceChannelLabels[task.sourceSync.channel]}
                    </dd>
                  </div>
                  <div>
                    <dt>物理来源</dt>
                    <dd>
                      {task.sourceSync.sourceSlug}
                      <small>
                        <code>{task.sourceSync.adapterKey}</code>
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>触发方式</dt>
                    <dd>{sourceTriggerLabels[task.sourceSync.trigger]}</dd>
                  </div>
                  <div>
                    <dt>同步运行 / 覆盖度</dt>
                    <dd>
                      {task.sourceSync.run
                        ? `${syncRunStatusLabels[task.sourceSync.run.status]} / ${syncCoverageLabels[task.sourceSync.run.coverage]}`
                        : '尚未开始同步运行'}
                    </dd>
                  </div>
                  <div>
                    <dt>本次获取职位</dt>
                    <dd>{task.sourceSync.run?.stats.discovered ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>新增 / 更新 / 未变化</dt>
                    <dd>
                      {task.sourceSync.run
                        ? [
                            task.sourceSync.run.stats.created,
                            task.sourceSync.run.stats.revised,
                            task.sourceSync.run.stats.unchanged,
                          ]
                            .map(String)
                            .join(' / ')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>入库记录 / 后续详情任务</dt>
                    <dd>
                      {task.sourceSync.run
                        ? [
                            task.sourceSync.run.stats.rawStored,
                            task.sourceSync.run.stats.followupEnqueued,
                          ]
                            .map(String)
                            .join(' / ')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>意向外 / 非国内 / 地域未知</dt>
                    <dd>
                      {task.sourceSync.run
                        ? [
                            task.sourceSync.run.stats.skippedOutOfScope,
                            task.sourceSync.run.stats.skippedNonDomestic,
                            task.sourceSync.run.stats.skippedUnknownRegion,
                          ]
                            .map(String)
                            .join(' / ')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>恢复 / 过期 / 关闭</dt>
                    <dd>
                      {task.sourceSync.run
                        ? [
                            task.sourceSync.run.stats.restored,
                            task.sourceSync.run.stats.staled,
                            task.sourceSync.run.stats.closed,
                          ]
                            .map(String)
                            .join(' / ')
                        : '—'}
                    </dd>
                  </div>
                </dl>
                {task.sourceSync.run?.errorSummary ? (
                  <p>{task.sourceSync.run.errorSummary}</p>
                ) : null}
              </section>
            ) : null}
            {task.status === 'failed' ? (
              <section className={styles.failureDetail} aria-labelledby="task-failure-heading">
                <h3 id="task-failure-heading">失败原因</h3>
                <p>
                  <strong>{task.errorCategory ?? '未分类'}</strong>
                </p>
                <p>{task.errorSummary ?? '系统未记录可展示的失败原因。'}</p>
              </section>
            ) : null}
            {task.kind === 'task' ? <TaskActions taskId={task.id} status={task.status} /> : null}
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
