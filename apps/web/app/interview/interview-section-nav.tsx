'use client';

import { usePathname } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { PageTabs } from '../components/layout/page-tabs.js';

const sections = [
  { href: '/interview', label: 'AI 模拟面试' },
  { href: '/interview/experiences', label: '历史面经' },
  { href: '/interview/research', label: '网友面经' },
] as const;

export function InterviewSectionNav(): ReactElement {
  const pathname = usePathname();
  return (
    <PageTabs
      label="面试准备"
      items={sections.map((section) => {
        const current =
          section.href === '/interview'
            ? pathname === '/interview' || pathname.startsWith('/interview/projects/')
            : pathname.startsWith(section.href);
        return { ...section, active: current };
      })}
    />
  );
}
