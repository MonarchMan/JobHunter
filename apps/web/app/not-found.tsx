import type { ReactElement } from 'react';
import { NavigationLink } from './components/layout/navigation-pending.js';

export default function NotFound(): ReactElement {
  return (
    <main id="main-content" className="error-state" tabIndex={-1}>
      <h1>页面不存在</h1>
      <p>这个页面可能已被移除，或链接地址不再有效。</p>
      <div className="inline-actions">
        <NavigationLink className="button-primary" href="/">
          返回工作台
        </NavigationLink>
        <NavigationLink className="button-secondary" href="/jobs">
          查看职位
        </NavigationLink>
      </div>
    </main>
  );
}
