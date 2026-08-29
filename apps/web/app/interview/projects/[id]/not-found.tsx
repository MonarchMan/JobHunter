import type { ReactElement } from 'react';

export default function ProjectDrillNotFound(): ReactElement {
  return (
    <main id="main-content" className="empty-state" tabIndex={-1}>
      <p className="eyebrow">PROJECT DOSSIER</p>
      <h1>准备档案不存在</h1>
      <p>它可能已被删除，或者链接中的项目标识无效。</p>
      <a className="button-primary" href="/interview">
        返回面试准备
      </a>
    </main>
  );
}
