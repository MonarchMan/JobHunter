'use client';

import { useRouter } from 'next/navigation.js';
import { useTransition, type ReactElement } from 'react';

export function JobsRefresh(): ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="jobs-refresh">
      <button
        type="button"
        className="button-muted"
        disabled={pending}
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      >
        {pending ? '正在刷新…' : '刷新职位'}
      </button>
      <span className="sr-only" aria-live="polite">
        {pending ? '正在刷新职位列表' : '职位列表已更新'}
      </span>
    </div>
  );
}
