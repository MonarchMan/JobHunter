import { canonicalJobSubfamilies } from '@jobhunter/domain';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Pagination } from '../components/lists/pagination.js';
import { SelectField } from '../components/forms/select-field.js';
import { JobsRefresh } from './jobs-refresh.js';
import { PageHeader } from '../components/layout/page-header.js';
import { JobsTable } from './jobs-table.js';
import { CompanyCombobox } from '../components/forms/company-combobox.js';
import { getWebContainer } from '../../src/server/container.js';
import {
  firstSearchParameter,
  pageHref,
  parseWebJobQuery,
  type SearchParameterSource,
} from '../../src/server/job-query.js';
import styles from './page.module.css';
import { JobsFilterMemory } from './jobs-filter-memory.js';
import { JobSourceFilter } from './job-source-filter.js';
import { PlatformBrowser } from '../sources/platform-browser.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '职位' };

interface JobsPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

function fieldValue(source: SearchParameterSource, name: string): string {
  return firstSearchParameter(source, name) ?? '';
}

export default async function JobsPage({
  searchParams,
}: JobsPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const hasFilters =
    ['q', 'company', 'location', 'subfamily', 'status', 'sort', 'minScore', 'profile'].some(
      (name) => Boolean(firstSearchParameter(parameters, name)),
    ) || Boolean(firstSearchParameter(parameters, 'category'));
  const container = await getWebContainer();
  const jobListPreferences = container.services.settings.get().jobListPreferences;
  const effectiveParameters = firstSearchParameter(parameters, 'sort')
    ? parameters
    : { ...parameters, sort: jobListPreferences.defaultSort };
  const companies = container.services.webSources.list();
  const profiles = container.services.webProfiles.list();
  const defaultProfileId = profiles[0]?.currentVersionId;
  const query = parseWebJobQuery(
    firstSearchParameter(parameters, 'profile') || !defaultProfileId
      ? effectiveParameters
      : { ...effectiveParameters, profile: defaultProfileId },
  );
  const page = container.services.webJobs.list(query);
  // 1、普通筛选的清除和空状态恢复保持平台范围，不能隐式跳到另一个平台。
  const scope = new URLSearchParams();
  if (query.sourceKind === 'platform') {
    scope.set('source', 'platform');
    if (query.providerKey) scope.set('provider', query.providerKey);
  }
  const clearHref = scope.size ? `/jobs?${scope.toString()}` : '/jobs';
  const sourcesHref =
    query.sourceKind === 'platform'
      ? `/sources?channel=platform${query.providerKey ? `&provider=${query.providerKey}` : ''}`
      : '/sources';
  return (
    <main id="main-content" tabIndex={-1}>
      <JobsFilterMemory enabled={jobListPreferences.rememberFilters} />
      <PageHeader
        title="职位列表"
        description="默认显示官网来源，隐藏已关闭职位。可切换招聘平台，筛选与分页只查询本地职位库。"
      />
      <JobSourceFilter
        sourceKind={query.sourceKind}
        {...(query.providerKey ? { providerKey: query.providerKey } : {})}
      />
      {query.sourceKind === 'platform' && query.providerKey && (
        <PlatformBrowser
          key={query.providerKey}
          provider={query.providerKey}
          initial={container.services[query.providerKey].snapshot()}
          placement="jobs"
        />
      )}
      <details className={styles.filterPanel} open={hasFilters}>
        <summary>筛选职位{hasFilters ? ' · 已设置条件' : ''}</summary>
        <form
          key={`${query.sourceKind}:${query.providerKey ?? ''}`}
          className={styles.filters}
          action="/jobs"
          method="get"
          aria-label="职位筛选"
          noValidate
          data-job-filters
        >
          <input type="hidden" name="source" value={query.sourceKind} />
          {query.sourceKind === 'platform' && query.providerKey && (
            <input type="hidden" name="provider" value={query.providerKey} />
          )}
          <label>
            招聘类别
            <SelectField
              name="category"
              label="招聘类别"
              defaultValue={query.recruitmentCategory}
              options={[
                { value: 'all', label: '全部招聘类别' },
                { value: 'internship', label: '实习' },
                { value: 'campus', label: '校招' },
                { value: 'social', label: '社招' },
              ]}
            />
          </label>
          <label>
            关键词
            <input
              name="q"
              defaultValue={fieldValue(parameters, 'q')}
              placeholder="Agent、大模型应用…"
            />
          </label>
          <label>
            公司
            <CompanyCombobox
              companies={
                query.sourceKind === 'platform'
                  ? page.items.map((job) => job.companyName)
                  : companies.map((company) => company.companyName)
              }
              defaultValue={fieldValue(parameters, 'company')}
            />
          </label>
          <label>
            地点
            <input
              name="location"
              defaultValue={fieldValue(parameters, 'location')}
              placeholder="北京,深圳"
            />
          </label>
          <label>
            职位类别
            <SelectField
              name="subfamily"
              label="职位类别"
              defaultValue={fieldValue(parameters, 'subfamily')}
              options={[
                { value: '', label: '全部类别' },
                ...canonicalJobSubfamilies.map((subfamily) => ({
                  value: subfamily,
                  label: subfamily,
                })),
              ]}
            />
          </label>
          <label>
            状态
            <SelectField
              name="status"
              label="状态"
              defaultValue={fieldValue(parameters, 'status')}
              options={[
                { value: '', label: '在招和待确认' },
                { value: 'active', label: '仅在招' },
                { value: 'stale', label: '仅待确认' },
                { value: 'closed', label: '仅已关闭' },
                { value: 'active,stale,closed', label: '全部状态' },
              ]}
            />
          </label>
          <label>
            排序
            <SelectField
              name="sort"
              label="排序"
              defaultValue={fieldValue(parameters, 'sort') || jobListPreferences.defaultSort}
              options={[
                { value: 'updated_desc', label: '最近更新' },
                { value: 'published_desc', label: '最近发布' },
                { value: 'score_desc', label: '匹配分数' },
              ]}
            />
          </label>
          <label>
            最低分
            <input
              name="minScore"
              type="number"
              min="0"
              max="100"
              defaultValue={fieldValue(parameters, 'minScore')}
            />
          </label>
          <label>
            个人资料版本
            <SelectField
              name="profile"
              label="个人资料版本"
              defaultValue={
                fieldValue(parameters, 'profile')
                  ? fieldValue(parameters, 'profile')
                  : (defaultProfileId ?? '')
              }
              options={[
                { value: '', label: '不使用资料匹配' },
                ...profiles
                  .filter((profile) => profile.currentVersionId !== null)
                  .map((profile) => ({
                    value: profile.currentVersionId ?? '',
                    label: profile.name,
                  })),
              ]}
            />
          </label>
          <button type="submit">应用筛选</button>
          <a className="button-secondary" href={clearHref}>
            清除
          </a>
        </form>
      </details>
      <div className={styles.resultToolbar}>
        <p className={styles.resultSummary} aria-live="polite">
          当前类别：
          {query.recruitmentCategory === 'all'
            ? '全部招聘类别'
            : query.recruitmentCategory === 'campus'
              ? '校招'
              : query.recruitmentCategory === 'social'
                ? '社招'
                : '实习'}{' '}
          · 共 {page.page.total} 个职位
        </p>
        <JobsRefresh />
      </div>
      {page.items.length === 0 ? (
        <section className="empty-state page-empty-state" aria-labelledby="jobs-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ⌕
          </span>
          <h2 id="jobs-empty-title">没有符合条件的职位</h2>
          <p>
            {query.sourceKind === 'platform'
              ? '尝试减少筛选条件，或在本页选择具体平台并获取一批职位；详情将自动补齐后入库。'
              : '尝试减少筛选条件，或先同步官网来源。'}
          </p>
          <div className="inline-actions">
            <a className="button-secondary" href={clearHref}>
              清除筛选
            </a>
            <a className="button-primary" href={sourcesHref}>
              管理招聘来源
            </a>
          </div>
        </section>
      ) : (
        <>
          <JobsTable jobs={page.items} profileVersionId={query.profileVersionId} />
        </>
      )}
      <Pagination
        currentPage={page.page.current}
        totalPages={page.page.totalPages}
        label="职位分页"
        createHref={(pageNumber) => `/jobs${pageHref(parameters, 'page', pageNumber)}`}
      />
    </main>
  );
}
