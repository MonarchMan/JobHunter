import type { ReactElement } from 'react';
import { NavigationLink } from '../../components/layout/navigation-pending.js';

export default function ResumeStudioNotFound(): ReactElement {
  return (
    <main id="main-content" data-resume-studio>
      <section className="empty-state page-empty-state">
        <h1>简历草稿不存在</h1>
        <p>它可能已随个人资料删除，或当前地址已经失效。</p>
        <NavigationLink className="button-primary" href="/my">
          返回个人资料
        </NavigationLink>
      </section>
    </main>
  );
}
