import type { ReactElement } from 'react';
import { PageHeader } from '../components/layout/page-header.js';
import { SectionLoading } from '../components/layout/section-loading.js';

/** 职位列表路由的轻量首屏，不读取职位数据。 */
export default function Loading(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="职位列表" />
      <SectionLoading label="正在加载职位列表" />
    </main>
  );
}
