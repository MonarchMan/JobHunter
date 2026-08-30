'use client';

import { usePathname } from 'next/navigation.js';
import type { ReactElement } from 'react';
import styles from './interview-section-nav.module.css';

const sections = [
  { href: '/interview', label: '项目拷打' },
  { href: '/interview/experiences', label: '历史面经' },
  { href: '/interview/research', label: '网友面经' },
] as const;

export function InterviewSectionNav(): ReactElement {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="面试准备">
      {sections.map((section) => {
        const current =
          section.href === '/interview'
            ? pathname === '/interview' || pathname.startsWith('/interview/projects/')
            : pathname.startsWith(section.href);
        return (
          <a
            href={section.href}
            aria-current={current ? 'page' : undefined}
            className={current ? styles.current : undefined}
            key={section.href}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
