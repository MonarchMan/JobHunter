import type { ReactElement } from 'react';
import { NavigationLink } from '../../components/layout/navigation-pending.js';

export default function JobNotFound(): ReactElement {
  return (
    <main id="main-content" className="empty-state" tabIndex={-1}>
      <h1>职位不存在</h1>
      <p>该职位可能已被删除，或链接不完整。</p>
      <NavigationLink className="button-secondary" href="/jobs">
        返回职位列表
      </NavigationLink>
    </main>
  );
}
