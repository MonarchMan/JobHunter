'use client';

import { useEffect, useState, type ReactElement } from 'react';
import {
  platformRetentionSummarySchema,
  type PlatformRetentionSummary,
} from '@jobhunter/application/platform-contracts';

/** 清理说明读取真实配置；页面可见时刷新本地状态，不发平台请求。 */
export function PlatformRetentionStatus(): ReactElement {
  const [summary, setSummary] = useState<PlatformRetentionSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let controller: AbortController | null = null;
    // 1、只读安全投影；新读取取消旧响应，失败不保留过期的启用状态。
    const refresh = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch('/api/platforms/retention', {
          cache: 'no-store',
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw new Error('Retention status unavailable');
        const body = (await response.json()) as { data: unknown };
        const value = platformRetentionSummarySchema.parse(body.data);
        if (!current.signal.aborted) {
          setSummary(value);
          setFailed(false);
        }
      } catch {
        if (!current.signal.aborted) {
          setSummary(null);
          setFailed(true);
        }
      }
    };
    const visible = (): void => {
      void refresh();
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return (
    <p role="status">
      {summary
        ? summary.enabled
          ? `平台自动保留清理已启用：连续 ${String(summary.policy.retentionDays)} 天无核验或交互且无保护引用的职位可被清理，每 ${String(summary.policy.intervalHours)} 小时检查。`
          : '平台自动保留清理未启用。'
        : failed
          ? '平台清理状态读取失败，请刷新页面重试；当前状态未知。'
          : '正在读取平台清理状态…'}
    </p>
  );
}
