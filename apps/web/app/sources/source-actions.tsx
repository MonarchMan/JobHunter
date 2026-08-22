'use client';

import type { WebSource } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';

interface ActionResponse {
  readonly data?: { readonly kind?: string; readonly task?: { readonly taskId?: string } };
  readonly error?: { readonly message?: string };
}

export function SourceActions({ source }: Readonly<{ source: WebSource }>): ReactElement {
  const [token] = useState(() => crypto.randomUUID());
  const [cronExpression, setCronExpression] = useState(
    source.schedule?.cronExpression ?? '0 9 * * *',
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(source.schedule?.enabled ?? true);
  const [feedback, setFeedback] = useState<string | null>(null);
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
      setFeedback(taskId ? `任务已创建：${taskId}` : '设置已保存。');
      if (!taskId) window.location.reload();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '来源操作失败。');
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
      <div className="inline-actions">
        <button
          type="button"
          aria-label={`立即同步 ${source.companyName}`}
          disabled={busy || !source.enabled}
          onClick={() => {
            void request(`/api/sources/${source.id}/sync`, 'POST', { idempotencyToken: token });
          }}
        >
          立即同步
        </button>
        <button
          type="button"
          className="button-muted"
          aria-label={`健康检查 ${source.companyName}`}
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
          aria-label={`${source.enabled ? '停用' : '启用'}来源 ${source.companyName}`}
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
      <form className="schedule-form" onSubmit={schedule}>
        <label>
          Cron（Asia/Shanghai）
          <input
            value={cronExpression}
            onChange={(event) => {
              setCronExpression(event.target.value);
            }}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(event) => {
              setScheduleEnabled(event.target.checked);
            }}
          />
          启用计划
        </label>
        <button
          type="submit"
          className="button-muted"
          disabled={busy}
          aria-label={`保存 ${source.companyName} 的同步计划`}
        >
          保存计划
        </button>
      </form>
      {feedback ? (
        <p className="action-feedback" role="status">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
