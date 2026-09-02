import type { ReactElement } from 'react';

export default function ResumeStudioNotFound(): ReactElement {
  return (
    <main id="main-content" data-resume-studio>
      <section className="empty-state page-empty-state">
        <h1>简历草稿不存在</h1>
        <p>它可能已随个人资料删除，或当前地址已经失效。</p>
        <a className="button-primary" href="/profile">
          返回个人资料
        </a>
      </section>
    </main>
  );
}
