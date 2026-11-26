import type { Metadata } from 'next';
import { Suspense, type ReactElement } from 'react';
import { PageTabs } from '../components/layout/page-tabs.js';
import { SectionLoading } from '../components/layout/section-loading.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import ProfilePage from '../profile/page.js';
import { ApplicationsProgressContent } from '../applications/page.js';
import styles from './my.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '我的' };

interface MyPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

/** “我的”聚合页，在同一入口切换个人资料与应聘进展。 */
export default async function MyPage({ searchParams }: MyPageProperties): Promise<ReactElement> {
  const query = await searchParams;
  const tab = firstSearchParameter(query, 'tab') === 'applications' ? 'applications' : 'profile';
  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <PageTabs
        label="我的页面分区"
        items={[
          { href: '/my?tab=profile', label: '个人资料', active: tab === 'profile' },
          { href: '/my?tab=applications', label: '应聘进展', active: tab === 'applications' },
        ]}
      />
      <section className={styles.content} aria-label={tab === 'profile' ? '个人资料' : '应聘进展'}>
        <Suspense
          key={tab}
          fallback={
            <SectionLoading
              label={tab === 'applications' ? '正在加载应聘进展' : '正在加载个人资料'}
            />
          }
        >
          {tab === 'applications' ? (
            <ApplicationsProgressContent embedded />
          ) : (
            <ProfilePage searchParams={Promise.resolve(query)} embedded />
          )}
        </Suspense>
      </section>
    </main>
  );
}
