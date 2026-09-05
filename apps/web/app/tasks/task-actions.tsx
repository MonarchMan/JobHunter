'use client';

import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';
import styles from './task-actions.module.css';
import { useToast } from '../components/toast-provider.js';

interface ActionResponse {
  readonly error?: { readonly message?: string };
}

export function TaskActions({
  taskId,
  status,
  taskType,
}: Readonly<{ taskId: string; status: string; taskType?: string }>): ReactElement | null {
  const router = useRouter();
  const [retryToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const act = async (action: 'retry' | 'cancel'): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}/${action}`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify(action === 'retry' ? { idempotencyToken: retryToken } : {}),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(result.error?.message ?? '任务操作失败。');
      showToast(action === 'retry' ? '重试任务已创建。' : '取消请求已提交。');
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : '任务操作失败。', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 1、维护审计由专用子进程管理，不提供普通队列的重试和取消入口。
  if (taskType === 'maintenance.sqlite') return <small>系统自动维护</small>;
  if (status !== 'failed' && status !== 'pending' && status !== 'running') return null;
  return (
    <div className={styles.cell}>
      {status === 'failed' ? (
        <button
          type="button"
          className="button-muted"
          aria-label={`重试任务 ${taskId}`}
          disabled={busy}
          onClick={() => {
            void act('retry');
          }}
        >
          重试
        </button>
      ) : (
        <button
          type="button"
          className="button-muted"
          aria-label={`取消任务 ${taskId}`}
          disabled={busy}
          onClick={() => {
            void act('cancel');
          }}
        >
          取消
        </button>
      )}
    </div>
  );
}
