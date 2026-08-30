import type { ReactElement } from 'react';

export default function NotFound(): ReactElement {
  return (
    <main id="main-content" className="error-state" tabIndex={-1}>
      <h1>页面不存在</h1>
      <p>这个页面可能已被移除，或链接地址不再有效。</p>
      <div className="inline-actions">
        <a className="button-primary" href="/">
          返回工作台
        </a>
        <a className="button-secondary" href="/jobs">
          查看职位
        </a>
      </div>
    </main>
  );
}
