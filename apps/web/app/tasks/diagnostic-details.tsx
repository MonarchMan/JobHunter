'use client';

import type {
  WebAgentRunDetail,
  WebAgentRunSummary,
  WebTask,
} from '@jobhunter/recruitment/contracts/web';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  labelStatus,
  labelTaskType,
  labelAgentErrorCategory,
  labelAgentKey,
  agentRunStatusLabels,
  taskStatusLabels,
} from '../components/status-labels.js';
import { Icon } from '../components/ui-icon.js';
import { TaskActions } from './task-actions.js';
import { TruncatedText } from '../components/lists/truncated-text.js';
import dataTableStyles from '../components/lists/data-table.module.css';
import styles from './diagnostic-details.module.css';
import { AgentBillingDetails } from './agent-billing-details.js';
import { taskPresentation } from './task-presentation.js';

/** 行和卡片共用名称按钮打开详情，按钮也提供键盘入口及焦点恢复。 */
export function DiagnosticRecord({
  as: Tag,
  className,
  children,
}: Readonly<{
  as: 'tr' | 'article';
  className?: string | undefined;
  children: ReactNode;
}>): ReactElement {
  return (
    <Tag
      className={[styles.record, className].filter(Boolean).join(' ')}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          event.target.closest('button, a, input, select, textarea, dialog')
        )
          return;
        event.currentTarget.querySelector<HTMLButtonElement>('[data-record-details]')?.click();
      }}
    >
      {children}
    </Tag>
  );
}

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
  succeeded: '完成',
  partial: '警告',
  failed: '失败',
  cancelled: '已取消',
} as const;

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
        <button
          type="button"
          className="button-close"
          onClick={onClose}
          autoFocus
          aria-label="关闭"
          title="关闭"
        >
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function TaskDetailsDialog({ task }: Readonly<{ task: WebTask }>): ReactElement {
  const presentation = taskPresentation(task);
  const [open, setOpen] = useState(false);
  const triggerReference = useRef<HTMLButtonElement>(null);
  const displayName = task.jobDetailBatch ? '职位详情同步' : labelTaskType(task.taskType);
  return (
    <>
      <button
        ref={triggerReference}
        type="button"
        className={styles.trigger}
        data-record-details
        aria-haspopup="dialog"
        title={displayName}
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
                <dd>{displayName}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <span className={`status status-${presentation.status}`}>
                    {presentation.label}
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
                <dt>开始 - 完成</dt>
                <dd>
                  {time(task.startedAt)} - {time(task.finishedAt)}
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
                {task.sourceSync.sources && task.sourceSync.sources.length > 1
                  ? task.sourceSync.sources.map((source) => (
                      <section key={source.adapterKey} aria-label={`${source.adapterKey} 同步结果`}>
                        <h4>
                          {source.companyName} / {source.sourceSlug}
                        </h4>
                        <p>
                          <code>{source.adapterKey}</code>：
                          {source.run ? syncRunStatusLabels[source.run.status] : '尚未开始同步运行'}
                        </p>
                        {source.run?.errorSummary ? <p>{source.run.errorSummary}</p> : null}
                      </section>
                    ))
                  : null}
                <dl className={['facts', styles.sourceFacts].filter(Boolean).join(' ')}>
                  <div>
                    <dt>公司 / 招聘渠道</dt>
                    <dd>
                      {task.sourceSync.companyName} / {sourceChannelLabels[task.sourceSync.channel]}
                    </dd>
                  </div>
                  <div>
                    <dt>物理来源</dt>
                    <dd>{task.sourceSync.sourceSlug}</dd>
                  </div>
                  <div>
                    <dt>触发方式</dt>
                    <dd>{sourceTriggerLabels[task.sourceSync.trigger]}</dd>
                  </div>
                  <div>
                    <dt>职位总数</dt>
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
                    <dt>关联详情任务</dt>
                    <dd>
                      {task.sourceSync.run
                        ? String(task.sourceSync.run.stats.followupEnqueued)
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
              </section>
            ) : null}
            {task.syncScoring ? (
              <section aria-label="评分阶段进度">
                <h3>评分阶段进度</h3>
                <dl className={['facts', styles.sourceFacts].filter(Boolean).join(' ')}>
                  <div>
                    <dt>已完成 / 总数</dt>
                    <dd>
                      {String(
                        task.syncScoring.items.filter((item) => item.status === 'succeeded').length,
                      )}{' '}
                      / {String(task.syncScoring.items.length)}
                    </dd>
                  </div>
                  <div>
                    <dt>失败</dt>
                    <dd>
                      {String(
                        task.syncScoring.items.filter((item) => item.status === 'failed').length,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>降级（模型不可用）</dt>
                    <dd>{String(task.syncScoring.degraded)}</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {task.status === 'failed' || presentation.warning ? (
              <section
                className={presentation.warning ? styles.warningDetail : styles.failureDetail}
                aria-labelledby="task-failure-heading"
              >
                <h3 id="task-failure-heading">{presentation.warning ? '警告信息' : '失败原因'}</h3>
                <p>
                  <strong>{presentation.errorCategory ?? '未分类'}</strong>
                </p>
                <p>{presentation.error || '系统未记录可展示的失败原因。'}</p>
              </section>
            ) : null}
            {task.kind === 'task' ? (
              <TaskActions
                taskId={task.id}
                status={task.status}
                taskType={task.taskType}
                size="regular"
              />
            ) : null}
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
        className={styles.trigger}
        data-record-details
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
        }}
      >
        {labelAgentKey(run.agentKey)}
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
                <dd>{labelAgentKey(run.agentKey)}</dd>
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
            <AgentBillingDetails calls={detail?.billingCalls ?? run.billingCalls} />
            {run.status === 'failed' ? (
              <section className={styles.failureDetail} aria-labelledby="agent-failure-heading">
                <h3 id="agent-failure-heading">失败原因</h3>
                <p>{run.errorCategory ? labelAgentErrorCategory(run.errorCategory) : '未分类'}</p>
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
