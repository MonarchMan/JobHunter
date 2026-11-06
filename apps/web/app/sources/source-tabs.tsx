import type { ReactElement } from 'react';
import styles from './source-tabs.module.css';
import { PageTabs } from '../components/layout/page-tabs.js';

export type SourceChannel = 'official' | 'platform';

/** 四个平台共享路由导航；能力说明不等同于平台连接状态。 */
export function PlatformTabs({
  active,
}: Readonly<{ active: 'boss' | 'zhilian' | '51job' | 'liepin' }>): ReactElement {
  // 1、URL 拥有当前选择，视觉选中与辅助技术使用同一判断。
  const platforms = [
    ['boss', 'BOSS 直聘'],
    ['zhilian', '智联招聘 · 校园／社招'],
    ['51job', '前程无忧'],
    ['liepin', '猎聘 · 学生推荐'],
  ] as const;
  return (
    <nav className={[styles.tabs, styles.platformTabs].join(' ')} aria-label="招聘平台选择">
      {platforms.map(([provider, label]) => (
        <a
          key={provider}
          className={[styles.tab, provider === active ? styles.active : ''].join(' ')}
          href={`/sources?channel=platform&provider=${provider}`}
          aria-current={provider === active ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

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
              <span className={styles.count}>4 · 实验中</span>
            </>
          ),
          active: active === 'platform',
        },
      ]}
    />
  );
}
