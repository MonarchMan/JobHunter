'use client';

import { useEffect, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation.js';

const storageKey = 'jobhunter.jobs.filters';

/** 在用户启用偏好后保存并恢复职位筛选 URL。 */
export function JobsFilterMemory({ enabled }: Readonly<{ enabled: boolean }>): ReactElement | null {
  const router = useRouter();
  const parameters = useSearchParams().toString();

  useEffect(() => {
    if (!enabled) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* 存储不可用不影响 URL 筛选。 */
      }
      return;
    }
    const form = document.querySelector<HTMLFormElement>('[data-job-filters]');
    const save = (): void => {
      if (!form) return;
      const parameters = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === 'string' && value) parameters.set(key, value);
      }
      // 1、仅记忆官网筛选；裸 /jobs 始终默认官网，不由平台浏览历史覆盖。
      if (parameters.get('source') === 'platform') return;
      try {
        localStorage.setItem(storageKey, parameters.toString());
      } catch {
        /* 存储不可用不影响提交。 */
      }
    };
    form?.addEventListener('submit', save);
    if (!window.location.search) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved && new URLSearchParams(saved).get('source') !== 'platform')
          router.replace(`/jobs?${saved}`);
      } catch {
        /* 隐私模式下保留默认官网视图。 */
      }
    }
    return () => form?.removeEventListener('submit', save);
  }, [enabled, router, parameters]);

  return null;
}
