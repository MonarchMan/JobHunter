import type { ReactElement } from 'react';

export default function JobNotFound(): ReactElement {
  return (
    <main id="main-content" className="empty-state" tabIndex={-1}>
      <p className="eyebrow">NOT FOUND</p>
      <h1>职位不存在</h1>
      <p>该职位可能已被删除，或链接不完整。</p>
      <a className="button-secondary" href="/jobs">
        返回职位列表
      </a>
    </main>
  );
}
