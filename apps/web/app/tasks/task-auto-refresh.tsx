'use client';

import { useRouter } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useState, useTransition } from 'react';

export function TaskAutoRefresh(): ReactElement {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = useCallback((): void => {
    startRefresh(() => {
      router.refresh();
      setUpdatedAt(new Date());
    });
  }, [router]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 10000);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [paused, refresh]);

  return (
    <div className="task-refresh" aria-live="polite">
      <span>{paused ? '自动刷新已暂停' : '自动刷新 · 每 10 秒'}</span>
      {updatedAt ? <small>刚刚更新</small> : null}
      <button type="button" className="button-muted" onClick={refresh} disabled={refreshing}>
        {refreshing ? '正在刷新…' : '立即刷新'}
      </button>
      <button
        type="button"
        className="button-link"
        onClick={() => {
          setPaused((value) => !value);
        }}
      >
        {paused ? '恢复自动刷新' : '暂停自动刷新'}
      </button>
    </div>
  );
}
