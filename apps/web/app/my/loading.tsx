import type { ReactElement } from 'react';
import { PageHeader } from '../components/layout/page-header.js';
import { SectionLoading } from '../components/layout/section-loading.js';

/** 段级占位不猜测查询参数对应的当前页签。 */
export default function Loading(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="我的" />
      <SectionLoading label="正在加载我的页面" />
    </main>
  );
}
