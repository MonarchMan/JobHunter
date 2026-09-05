'use client';

import type { WebSource, WebSourceChannel } from '@jobhunter/application/web';
import type { ReactElement, SyntheticEvent } from 'react';
import { useState } from 'react';
import { Icon } from '../components/ui-icon.js';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './source-actions.module.css';
import { useToast } from '../components/toast-provider.js';

interface ActionResponse {
  readonly data?: {
    readonly kind?: string;
    readonly task?: { readonly taskId?: string };
    readonly tasks?: readonly { readonly taskId?: string }[];
  };
  readonly error?: { readonly message?: string };
}

export function SourceChannelSyncAction({
  channels,
  contextLabel,
  actionLabel = '立即同步',
  syncReady,
}: Readonly<{
  channels: readonly WebSourceChannel[];
  contextLabel: string;
  actionLabel?: string;
  syncReady: boolean;
}>): ReactElement {
  const [tokens] = useState(() =>
    Object.fromEntries(channels.map((channel) => [channel.id, crypto.randomUUID()])),
  );
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const enabledChannels = channels.filter(
    (channel) =>
      channel.effectiveEnabled && channel.sources.some((source) => source.effectiveEnabled),
  );

  const sync = async (): Promise<void> => {
    setBusy(true);
    try {
      const headers = await mutationHeaders();
      const responses = await Promise.allSettled(
        enabledChannels.map(async (channel) => {
          const response = await fetch(`/api/source-channels/${channel.id}/sync`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ idempotencyToken: tokens[channel.id] }),
          });
          const result = (await response.json()) as ActionResponse;
          if (!response.ok) throw new Error(result.error?.message ?? '渠道同步失败。');
          return result.data?.tasks?.length ?? 0;
        }),
      );
      const taskCount = responses.reduce(
        (total, result) => total + (result.status === 'fulfilled' ? result.value : 0),
        0,
      );
      const failures = responses.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        const firstFailure: unknown = failures[0]?.reason;
        const reason = firstFailure instanceof Error ? firstFailure.message : '渠道同步失败。';
        showToast(
          taskCount > 0 ? `已创建 ${String(taskCount)} 个任务，部分渠道失败：${reason}` : reason,
          taskCount > 0 ? 'warning' : 'error',
        );
      } else {
        showToast(`同步任务已创建，共 ${String(taskCount)} 个来源。`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '渠道同步失败。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.headerSync} data-source-header-sync>
      <button
        type="button"
        className={styles.syncButton}
        aria-label={`${actionLabel} ${contextLabel}`}
        aria-busy={busy}
        disabled={busy || enabledChannels.length === 0 || !syncReady}
        aria-describedby={!syncReady ? 'source-sync-prerequisite' : undefined}
        onClick={() => void sync()}
      >
        <span className={busy ? styles.syncIconBusy : styles.syncIcon}>
          <Icon name="refresh" size={20} />
        </span>
        <span className={styles.syncTooltip} role="tooltip">
          {actionLabel}
        </span>
      </button>
    </div>
  );
}

export function SourceChannelToggle({
  channel,
}: Readonly<{ channel: WebSourceChannel }>): ReactElement {
  const [busy, setBusy] = useState(false);
  const { showToast, showToastAfterReload } = useToast();
  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch(`/api/source-channels/${channel.id}`, {
        method: 'PATCH',
        headers: await mutationHeaders(),
        body: JSON.stringify({ kind: 'enable', enabled: !channel.enabled }),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(result.error?.message ?? '渠道设置保存失败。');
      showToastAfterReload('渠道设置已保存。');
      window.location.reload();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '渠道设置保存失败。', 'error');
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" className="button-muted" disabled={busy} onClick={() => void toggle()}>
        {channel.enabled ? '停用渠道' : '启用渠道'}
      </button>
    </div>
  );
}

export function SourceSyncAction({
  sources,
  contextLabel,
  actionLabel = '立即同步',
  syncReady,
}: Readonly<{
  sources: readonly WebSource[];
  contextLabel: string;
  actionLabel?: string;
  syncReady: boolean;
}>): ReactElement {
  const [tokens] = useState(() =>
    Object.fromEntries(sources.map((source) => [source.id, crypto.randomUUID()])),
  );
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const enabledSources = sources.filter((source) => source.enabled);

  const sync = async (): Promise<void> => {
    setBusy(true);
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
        showToast(
          succeeded > 0
            ? `已创建 ${String(succeeded)} 个任务，${String(failures.length)} 个失败：${reason}`
            : reason,
          succeeded > 0 ? 'warning' : 'error',
        );
        return;
      }
      showToast(succeeded > 1 ? `已创建 ${String(succeeded)} 个同步任务。` : '同步任务已创建。');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '来源同步失败。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.headerSync} data-source-header-sync>
      <button
        type="button"
        className={styles.syncButton}
        aria-label={`${actionLabel} ${contextLabel}`}
        aria-busy={busy}
        disabled={busy || enabledSources.length === 0 || !syncReady}
        aria-describedby={!syncReady ? 'source-sync-prerequisite' : undefined}
        onClick={() => {
          void sync();
        }}
      >
        <span className={busy ? styles.syncIconBusy : styles.syncIcon}>
          <Icon name="refresh" size={20} />
        </span>
        <span className={styles.syncTooltip} role="tooltip">
          {actionLabel}
        </span>
      </button>
      <span className="sr-only" aria-live="polite">
        {busy ? `${actionLabel}进行中` : ''}
      </span>
    </div>
  );
}

export function SourceActions({
  source,
  syncReady,
  contextLabel = source.companyName,
}: Readonly<{ source: WebSource; syncReady: boolean; contextLabel?: string }>): ReactElement {
  const [token] = useState(() => crypto.randomUUID());
  const [cronExpression, setCronExpression] = useState(
    source.schedule?.cronExpression ?? '0 9 * * *',
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(source.schedule?.enabled ?? true);
  const { showToast, showToastAfterReload } = useToast();
  const [busy, setBusy] = useState(false);

  const request = async (url: string, method: 'POST' | 'PATCH', body: unknown): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: await mutationHeaders(),
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(result.error?.message ?? '来源操作失败。');
      const taskId = result.data?.task?.taskId;
      if (taskId) {
        showToast('同步任务已创建。');
      } else {
        showToastAfterReload('设置已保存。');
        window.location.reload();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '来源操作失败。', 'error');
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
    <div className={styles.actions} data-source-actions>
      <details className={styles.advanced} data-source-advanced>
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
        <form className={styles.scheduleForm} data-source-schedule onSubmit={schedule} noValidate>
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
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={scheduleEnabled}
              aria-describedby={!syncReady ? 'source-sync-prerequisite' : undefined}
              onChange={(event) => {
                setScheduleEnabled(event.target.checked);
              }}
            />{' '}
            启用计划
          </label>
          <button
            type="submit"
            className="button-muted"
            disabled={busy || (!syncReady && scheduleEnabled)}
            aria-describedby={!syncReady ? 'source-sync-prerequisite' : undefined}
            aria-label={`保存 ${contextLabel} 的同步计划`}
          >
            保存计划
          </button>
        </form>
      </details>
    </div>
  );
}
