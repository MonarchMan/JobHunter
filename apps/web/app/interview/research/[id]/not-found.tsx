import type { ReactElement } from 'react';

export default function ResearchNotFound(): ReactElement {
  return (
    <main id="main-content" className="empty-state" tabIndex={-1}>
      <p className="eyebrow">RESEARCH NOT FOUND</p>
      <h1>找不到这份研究请求</h1>
      <p>它可能已被移除，或链接中的标识无效。你可以返回网友面经重新选择。</p>
      <a className="button-primary" href="/interview/research">
        返回网友面经
      </a>
    </main>
  );
}
