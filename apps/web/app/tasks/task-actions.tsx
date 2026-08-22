'use client';

import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';

interface ActionResponse {
  readonly error?: { readonly message?: string };
}

export function TaskActions({
  taskId,
  status,
}: Readonly<{ taskId: string; status: string }>): ReactElement | null {
  const router = useRouter();
  const [retryToken] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'pending' && status !== 'running') return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [router, status]);

  const act = async (action: 'retry' | 'cancel'): Promise<void> => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/${action}`, {
        method: 'POST',
        headers: await mutationHeaders(),
        body: JSON.stringify(action === 'retry' ? { idempotencyToken: retryToken } : {}),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok) throw new Error(result.error?.message ?? '任务操作失败。');
      setFeedback(action === 'retry' ? '重试任务已创建。' : '取消请求已提交。');
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '任务操作失败。');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'failed' && status !== 'pending' && status !== 'running') return null;
  return (
    <div className="task-action-cell">
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
      {feedback ? <span role="status">{feedback}</span> : null}
    </div>
  );
}
