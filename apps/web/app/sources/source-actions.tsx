'use client';

import type { WebSource } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';

interface ActionResponse {
  readonly data?: { readonly kind?: string; readonly task?: { readonly taskId?: string } };
  readonly error?: { readonly message?: string };
}

interface ActionFeedback {
  readonly tone: 'success' | 'error';
  readonly message: string;
}

export function SourceSyncAction({
  sources,
  contextLabel,
}: Readonly<{ sources: readonly WebSource[]; contextLabel: string }>): ReactElement {
  const [tokens] = useState(() =>
    Object.fromEntries(sources.map((source) => [source.id, crypto.randomUUID()])),
  );
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const enabledSources = sources.filter((source) => source.enabled);

  const sync = async (): Promise<void> => {
    setBusy(true);
    setFeedback(null);
    try {
      const results = await Promise.allSettled(
        enabledSources.map(async (source) => {
          const response = await fetch(`/api/sources/${source.id}/sync`, {
            method: 'POST',
            headers: await mutationHeaders(),
            body: JSON.stringify({ idempotencyToken: tokens[source.id] }),
          });
          const result = (await response.json()) as ActionResponse;
          if (!response.ok) throw new Error(result.error?.message ?? '来源同步失败。');
          return result;
        }),
      );
      const succeeded = results.filter((result) => result.status === 'fulfilled').length;
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        const firstFailure: unknown = failures[0]?.reason;
        const reason = firstFailure instanceof Error ? firstFailure.message : '来源同步失败。';
        setFeedback({
          tone: 'error',
          message:
            succeeded > 0
              ? `已创建 ${String(succeeded)} 个任务，${String(failures.length)} 个失败：${reason}`
              : reason,
        });
        return;
      }
      setFeedback({
        tone: 'success',
        message: succeeded > 1 ? `已创建 ${String(succeeded)} 个同步任务。` : '同步任务已创建。',
      });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '来源同步失败。',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="source-header-sync">
      <button
        type="button"
        aria-label={`立即同步 ${contextLabel}`}
        disabled={busy || enabledSources.length === 0}
        onClick={() => {
          void sync();
        }}
      >
        {busy ? '正在同步…' : '立即同步'}
      </button>
      {feedback ? (
        <p
          className={`source-header-feedback source-header-feedback-${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

export function SourceActions({
  source,
  contextLabel = source.companyName,
}: Readonly<{ source: WebSource; contextLabel?: string }>): ReactElement {
  const [token] = useState(() => crypto.randomUUID());
  const [cronExpression, setCronExpression] = useState(
    source.schedule?.cronExpression ?? '0 9 * * *',
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(source.schedule?.enabled ?? true);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (url: string, method: 'POST' | 'PATCH', body: unknown): Promise<void> => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(url, {
        method,
        headers: await mutationHeaders(),
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(result.error?.message ?? '来源操作失败。');
      const taskId = result.data?.task?.taskId;
      setFeedback({ tone: 'success', message: taskId ? '同步任务已创建。' : '设置已保存。' });
      if (!taskId) window.location.reload();
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '来源操作失败。',
      });
    } finally {
      setBusy(false);
    }
  };

  const schedule = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void request(`/api/sources/${source.id}`, 'PATCH', {
      kind: 'schedule',
      cronExpression,
      timezone: 'Asia/Shanghai',
      enabled: scheduleEnabled,
    });
  };

  return (
    <div className="source-actions">
      <details className="source-advanced">
        <summary>高级设置</summary>
        <div className="inline-actions">
          <button
            type="button"
            className="button-muted"
            aria-label={`健康检查 ${contextLabel}`}
            disabled={busy}
            onClick={() => {
              void request(`/api/sources/${source.id}/health`, 'POST', {
                idempotencyToken: `health-${token}`,
              });
            }}
          >
            健康检查
          </button>
          <button
            type="button"
            className="button-muted"
            aria-label={`${source.enabled ? '停用' : '启用'}来源 ${contextLabel}`}
            disabled={busy}
            onClick={() => {
              void request(`/api/sources/${source.id}`, 'PATCH', {
                kind: 'enable',
                enabled: !source.enabled,
              });
            }}
          >
            {source.enabled ? '停用来源' : '启用来源'}
          </button>
        </div>
        <form className="schedule-form" onSubmit={schedule} noValidate>
          <label>
            {' '}
            Cron（Asia/Shanghai）{' '}
            <input
              value={cronExpression}
              onChange={(event) => {
                setCronExpression(event.target.value);
              }}
            />{' '}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(event) => {
                setScheduleEnabled(event.target.checked);
              }}
            />{' '}
            启用计划
          </label>
          <button
            type="submit"
            className="button-muted"
            disabled={busy}
            aria-label={`保存 ${contextLabel} 的同步计划`}
          >
            保存计划
          </button>
        </form>
      </details>
      {feedback ? (
        <p
          className={`action-feedback action-feedback-${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
