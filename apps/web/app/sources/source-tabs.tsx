import type { ReactElement } from 'react';

export type SourceChannel = 'official' | 'platform';

export function SourceTabs({
  active,
  officialCount,
}: Readonly<{ active: SourceChannel; officialCount: number }>): ReactElement {
  return (
    <nav className="source-tabs" aria-label="招聘来源分类">
      <a
        className={active === 'official' ? 'source-tab is-active' : 'source-tab'}
        href="/sources"
        aria-current={active === 'official' ? 'page' : undefined}
      >
        <span>官网来源</span>
        <span className="source-tab-count">{officialCount}</span>
      </a>
      <a
        className={active === 'platform' ? 'source-tab is-active' : 'source-tab'}
        href="/sources?channel=platform"
        aria-current={active === 'platform' ? 'page' : undefined}
      >
        <span>招聘平台来源</span>
        <span className="source-tab-count">暂未接入</span>
      </a>
    </nav>
  );
}
