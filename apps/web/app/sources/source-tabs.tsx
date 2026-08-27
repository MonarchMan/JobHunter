import type { ReactElement } from 'react';
import styles from './source-tabs.module.css';

export type SourceChannel = 'official' | 'platform';

export function SourceTabs({
  active,
  officialCount,
}: Readonly<{ active: SourceChannel; officialCount: number }>): ReactElement {
  return (
    <nav className={styles.tabs} aria-label="招聘来源分类">
      <a
        className={[styles.tab, active === 'official' ? styles.active : undefined]
          .filter(Boolean)
          .join(' ')}
        href="/sources"
        aria-current={active === 'official' ? 'page' : undefined}
      >
        <span>官网来源</span>
        <span className={styles.count}>{officialCount}</span>
      </a>
      <a
        className={[styles.tab, active === 'platform' ? styles.active : undefined]
          .filter(Boolean)
          .join(' ')}
        href="/sources?channel=platform"
        aria-current={active === 'platform' ? 'page' : undefined}
      >
        <span>招聘平台来源</span>
        <span className={styles.count}>暂未接入</span>
      </a>
    </nav>
  );
}
