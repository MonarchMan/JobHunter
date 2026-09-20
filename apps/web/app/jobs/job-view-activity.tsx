'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { mutationHeaders } from '../../src/client/csrf.js';

/** 仅实际展示的详情页记录一次本地交互；不在 GET、预取或后台定时器中写入。 */
export function JobViewActivity({ jobId }: { readonly jobId: string }): ReactElement | null {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let sent = false;
    // 浏览器状态可能在 await 期间变化，读取函数避免静态收窄为旧值。
    const isVisible = (): boolean => document.visibilityState === 'visible';
    const isAborted = (): boolean => controller.signal.aborted;
    // 1、隐藏页面等到可见才记录；一次挂载只发一次，失败只能显式重试。
    const record = async (): Promise<void> => {
      if (sent || !isVisible() || isAborted()) return;
      sent = true;
      try {
        const headers = await mutationHeaders();
        if (isAborted()) return;
        if (!isVisible()) {
          sent = false;
          return;
        }
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/view`, {
          method: 'POST',
          headers,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) throw new Error('View activity failed');
      } catch {
        if (!isAborted()) setFailed(true);
      }
    };
    const onVisible = (): void => {
      void record();
    };
    // 2、延后到客户端提交完成，StrictMode 清理可取消尚未发送的首次动作。
    const timer = window.setTimeout(onVisible, 0);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      controller.abort();
    };
  }, [jobId, attempt]);
  if (!failed) return null;
  return (
    <p role="status">
      浏览记录未保存，未延长平台职位保留期。{' '}
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      >
        重试记录浏览
      </button>
    </p>
  );
}
