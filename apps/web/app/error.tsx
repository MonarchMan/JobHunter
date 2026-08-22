'use client';

import type { ReactElement } from 'react';
import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): ReactElement {
  useEffect(() => {
    // Next.js logs the server-side detail; the UI only renders a stable recovery path.
    console.error(error);
  }, [error]);
  return (
    <main id="main-content" className="error-state" tabIndex={-1}>
      <p className="eyebrow">ERROR</p>
      <h1>页面暂时无法加载</h1>
      <p>请确认已运行初始化命令，或稍后重试。</p>
      <button type="button" onClick={reset}>
        重新加载
      </button>
    </main>
  );
}
