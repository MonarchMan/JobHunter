'use client';

import { useEffect, type ReactElement } from 'react';
import { useRouter } from 'next/navigation.js';

const storageKey = 'jobhunter.jobs.filters';

/** 在用户启用偏好后保存并恢复职位筛选 URL。 */
export function JobsFilterMemory({ enabled }: Readonly<{ enabled: boolean }>): ReactElement | null {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      localStorage.removeItem(storageKey);
      return;
    }
    const form = document.querySelector<HTMLFormElement>('[data-job-filters]');
    const save = (): void => {
      if (!form) return;
      const parameters = new URLSearchParams();
      for (const [key, value] of new FormData(form).entries()) {
        if (typeof value === 'string' && value) parameters.set(key, value);
      }
      localStorage.setItem(storageKey, parameters.toString());
    };
    form?.addEventListener('submit', save);
    if (!window.location.search) {
      const saved = localStorage.getItem(storageKey);
      if (saved) router.replace(`/jobs?${saved}`);
    }
    return () => form?.removeEventListener('submit', save);
  }, [enabled, router]);

  return null;
}
