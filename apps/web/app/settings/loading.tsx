import type { ReactElement } from 'react';
import { PageHeader } from '../components/layout/page-header.js';
import { SectionLoading } from '../components/layout/section-loading.js';

/** 设置路由的轻量首屏，具体区块由页面独立输出。 */
export default function Loading(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="设置" />
      <SectionLoading label="正在加载设置" />
    </main>
  );
}
