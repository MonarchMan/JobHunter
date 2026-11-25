'use client';

import NextLink, { useLinkStatus } from 'next/link.js';
import type { ReactElement } from 'react';
import styles from './navigation-pending.module.css';

// NodeNext 将 Next.js 的 CommonJS 入口推断为模块对象，实际默认导出是链接组件。
export const NavigationLink = NextLink as unknown as typeof NextLink.default;

/** 仅在当前链接等待服务端响应时显示进度，不提前改变当前页语义。 */
export function NavigationPending(): ReactElement | null {
  const { pending } = useLinkStatus();
  return pending ? <span className={styles.indicator} role="status" aria-label="正在加载" /> : null;
}
