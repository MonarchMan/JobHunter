import type { ReactElement } from 'react';
import { PageTabs } from '../components/layout/page-tabs.js';
/** 任务页的地址化视图切换，刷新及浏览器返回保留当前 tab。 */
export function TaskTabs({ usage = false }: { usage?: boolean }): ReactElement {
  return (
    <PageTabs
      label="任务视图"
      items={[
        { href: '/tasks', label: '任务与Agent', active: !usage },
        { href: '/tasks?tab=usage', label: '用量统计', active: usage },
      ]}
    />
  );
}
