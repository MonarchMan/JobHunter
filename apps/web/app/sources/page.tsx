import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeader } from '../components/page-header.js';
import { getWebContainer } from '../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import { SourceTabs, type SourceChannel } from './source-tabs.js';
import { Pagination } from '../components/pagination.js';
import { webPagination, type WebSource } from '@jobhunter/application/web';
import { CompanySourceCard } from './company-source-card.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '招聘来源' };

interface SourcesPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

export default async function SourcesPage({
  searchParams,
}: SourcesPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const channel: SourceChannel =
    firstSearchParameter(parameters, 'channel') === 'platform' ? 'platform' : 'official';
  const requestedPage = Number(firstSearchParameter(parameters, 'page') ?? '1');
  const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const container = await getWebContainer();
  const sources = container.services.webSources.list();
  const companies = Array.from(
    sources.reduce((groups, source) => {
      const existing = groups.get(source.companyId) ?? [];
      groups.set(source.companyId, [...existing, source]);
      return groups;
    }, new Map<string, WebSource[]>()),
    ([companyId, companySources]) => ({ companyId, sources: companySources }),
  );
  const sourcePage = webPagination(companies.length, pageNumber, 10);
  const officialCompanies =
    channel === 'official'
      ? companies.slice(
          (sourcePage.current - 1) * sourcePage.pageSize,
          sourcePage.current * sourcePage.pageSize,
        )
      : [];
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow="RECRUITMENT SOURCES"
        title="招聘来源"
        description="按来源类型管理职位同步。操作仅创建后台任务，页面请求不会执行采集或健康检查。"
      />
      <SourceTabs active={channel} officialCount={companies.length} />
      {channel === 'platform' ? (
        <section className="empty-state page-empty-state" aria-labelledby="platform-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ✦
          </span>
          <h2 id="platform-empty-title">招聘平台来源暂未接入</h2>
          <p>当前先支持企业官网来源。后续接入招聘平台后，相关来源会集中展示在这里。</p>
          <a className="button-secondary" href="/sources">
            查看官网来源
          </a>
        </section>
      ) : officialCompanies.length === 0 ? (
        <section className="empty-state page-empty-state" aria-labelledby="sources-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ◌
          </span>
          <h2 id="sources-empty-title">还没有招聘来源</h2>
          <p>先用 CLI 初始化或导入招聘来源，回来后就能在这里管理同步和健康检查。</p>
          <a className="button-primary" href="/">
            返回工作台
          </a>
        </section>
      ) : (
        <>
          <div className="source-list">
            {officialCompanies.map((company) => (
              <CompanySourceCard key={company.companyId} sources={company.sources} />
            ))}
          </div>
          <Pagination
            currentPage={sourcePage.current}
            totalPages={sourcePage.totalPages}
            label="招聘来源分页"
            createHref={(page) =>
              `/sources?${new URLSearchParams({ page: String(page) }).toString()}`
            }
          />
        </>
      )}
    </main>
  );
}
