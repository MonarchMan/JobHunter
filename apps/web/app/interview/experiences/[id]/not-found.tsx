import type { ReactElement } from 'react';

export default function ExperienceNotFound(): ReactElement {
  return (
    <main id="main-content" className="empty-state" tabIndex={-1}>
      <p className="eyebrow">PERSONAL HISTORY</p>
      <h1>面经文档不存在</h1>
      <p>它可能已被删除，或者链接中的文档标识无效。</p>
      <a className="button-primary" href="/interview/experiences">
        返回历史面经
      </a>
    </main>
  );
}
