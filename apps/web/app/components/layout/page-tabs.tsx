import type { ReactElement, ReactNode } from 'react';
import styles from './page-tabs.module.css';

/** 一级分区导航兼作页面标题，当前分区提供唯一可访问主标题。 */
export function PageTabs({
  label,
  items,
  heading = true,
}: Readonly<{
  label: string;
  /** 详情页已有主标题时只保留导航语义。 */
  heading?: boolean;
  items: readonly { href: string; label: ReactNode; active: boolean }[];
}>): ReactElement {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map((item) => (
        <a key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>
          {item.active && heading ? <h1>{item.label}</h1> : item.label}
        </a>
      ))}
    </nav>
  );
}
