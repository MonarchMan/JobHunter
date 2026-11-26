import type { ReactElement } from 'react';
import { PageHeader } from '../../components/layout/page-header.js';
import { SectionLoading } from '../../components/layout/section-loading.js';

/** 详情段冷进入时说明目标，真实职位标题由详情读取提供。 */
export default function Loading(): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="职位详情" />
      <SectionLoading label="正在加载职位详情" />
    </main>
  );
}
