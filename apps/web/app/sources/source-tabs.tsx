import type { ReactElement } from 'react';
import styles from './source-tabs.module.css';
import { PageTabs } from '../components/layout/page-tabs.js';

export type SourceChannel = 'official' | 'platform';

export function SourceTabs({
  active,
  officialCount,
}: Readonly<{ active: SourceChannel; officialCount: number }>): ReactElement {
  return (
    <PageTabs
      label="招聘来源分类"
      items={[
        {
          href: '/sources',
          label: (
            <>
              <span>官网来源</span>
              <span className={styles.count}>{officialCount}</span>
            </>
          ),
          active: active === 'official',
        },
        {
          href: '/sources?channel=platform',
          label: (
            <>
              <span>招聘平台来源</span>
              <span className={styles.count}>4</span>
            </>
          ),
          active: active === 'platform',
        },
      ]}
    />
  );
}
