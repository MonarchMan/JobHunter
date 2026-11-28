import { SearchButton } from '../components/forms/search-button.js';
import { NavigationForm } from '../components/forms/navigation-form.js';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import { listPageSize } from '../../src/server/job-query.js';
import { canonicalJobSubfamilies } from '@jobhunter/recruitment/domain';
import type { Metadata } from 'next';
import { Suspense, type ReactElement } from 'react';
import { Pagination } from '../components/lists/pagination.js';
import { SelectField } from '../components/forms/select-field.js';
import { NumberField } from '../components/forms/number-field.js';
import { JobsRefresh } from './jobs-refresh.js';
import { PageHeader } from '../components/layout/page-header.js';
import { SectionLoading } from '../components/layout/section-loading.js';
import { JobsTable } from './jobs-table.js';
import { CompanyCombobox } from '../components/forms/company-combobox.js';
import { getWebContainer } from '../../src/server/container.js';
import { browserTestRenderDelay } from '../../src/server/browser-test-render-delay.js';
import {
  firstSearchParameter,
  pageHref,
  parseWebJobQuery,
  type SearchParameterSource,
} from '../../src/server/job-query.js';
import styles from './page.module.css';
import { JobsFilterMemory } from './jobs-filter-memory.js';
import { JobSourceFilter } from './job-source-filter.js';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '职位' };

interface JobsPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

function fieldValue(source: SearchParameterSource, name: string): string {
  return firstSearchParameter(source, name) ?? '';
}

/** 职位标题不依赖列表查询；列表筛选与结果仍使用同一个服务端快照。 */
export default function JobsPage({ searchParams }: JobsPageProperties): ReactElement {
  return (
    <main id="main-content" tabIndex={-1}>
      <Suspense fallback={<JobsListLoading />}>
        <JobsListContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** 加载时保留列表标题，不提前展示未知的来源、总数或筛选结果。 */
function JobsListLoading(): ReactElement {
  return (
    <>
      <PageHeader title="职位列表" />
      <SectionLoading label="正在加载职位列表" />
    </>
  );
}

/** 读取当前筛选条件对应的列表、来源与画像。 */
async function JobsListContent({ searchParams }: JobsPageProperties): Promise<ReactElement> {
  await browserTestRenderDelay('jobs');
  const parameters = await searchParams;
  const hasFilters =
    ['q', 'company', 'location', 'subfamily', 'status', 'sort', 'minScore', 'profile'].some(
      (name) => Boolean(firstSearchParameter(parameters, name)),
    ) || Boolean(firstSearchParameter(parameters, 'category'));
  const container = await getWebContainer();
  const jobListPreferences = container.services.settings.get().jobListPreferences;
  const effectiveParameters =
    firstSearchParameter(parameters, 'sort') ||
    firstSearchParameter(parameters, 'source') === 'platform'
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
  const page = container.services.webJobs.list({
    ...query,
    limit: listPageSize(parameters),
    pageSize: listPageSize(parameters),
  });
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
    <>
      <JobsFilterMemory enabled={jobListPreferences.rememberFilters} />
      <PageHeader title="职位列表">
        <div data-job-source-switcher>
          <JobSourceFilter field="source" value={query.sourceKind} />
        </div>
      </PageHeader>
      <details className={styles.filterPanel} open={hasFilters}>
        <summary>筛选职位{hasFilters ? ' · 已设置条件' : ''}</summary>
        <NavigationForm
          key={JSON.stringify(Object.entries(parameters).filter(([name]) => name !== 'page'))}
          className={styles.filters}
          action="/jobs"
          aria-label="职位筛选"
          noValidate
          data-job-filters
        >
          <input type="hidden" name="source" value={query.sourceKind} />
          {query.sourceKind === 'platform' && query.providerKey && (
            <input type="hidden" name="provider" value={query.providerKey} />
          )}
          <div className={styles.selectRow}>
            <label>
              招聘类别
              <SelectField
                name="category"
                label="招聘类别"
                defaultValue={query.recruitmentCategory}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'internship', label: '实习' },
                  { value: 'campus', label: '校招' },
                  { value: 'social', label: '社招' },
                ]}
              />
            </label>
            <label>
              职位类别
              <SelectField
                name="subfamily"
                fitOptions
                label="职位类别"
                defaultValue={fieldValue(parameters, 'subfamily')}
                options={[
                  { value: '', label: '全部' },
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
                  { value: 'active,stale,closed', label: '全部' },
                ]}
              />
            </label>
            <label>
              排序
              <SelectField
                name="sort"
                label="排序"
                defaultValue={query.sort}
                options={[
                  { value: 'updated_desc', label: '最近更新' },
                  { value: 'published_desc', label: '最近发布' },
                  { value: 'score_desc', label: '匹配分数' },
                ]}
              />
            </label>
            <label className={styles.mobileSortDirection}>
              排序方向
              <SelectField
                name="direction"
                label="排序方向"
                defaultValue={query.direction ?? 'desc'}
                options={[
                  { value: 'desc', label: '降序' },
                  { value: 'asc', label: '升序' },
                ]}
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
            <label className={styles.companyField}>
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
          </div>
          <div className={styles.inputRow}>
            <label>
              关键词
              <input
                name="q"
                defaultValue={fieldValue(parameters, 'q')}
                placeholder="Agent、大模型应用…"
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
            <label className={styles.scoreField}>
              最低分
              <NumberField
                label="最低分"
                name="minScore"
                min="0"
                max="100"
                defaultValue={fieldValue(parameters, 'minScore')}
              />
            </label>
            <div className={styles.filterActions}>
              <SearchButton />
              <NavigationLink className="button-secondary" href={clearHref}>
                清除
              </NavigationLink>
            </div>
          </div>
        </NavigationForm>
      </details>
      <div className={styles.resultToolbar}>
        <p className={styles.resultSummary} aria-live="polite">
          当前类别：
          {query.recruitmentCategory === 'all'
            ? '全部'
            : query.recruitmentCategory === 'campus'
              ? '校招'
              : query.recruitmentCategory === 'social'
                ? '社招'
                : '实习'}{' '}
          · 共 {page.page.total} 个职位
        </p>
        <div className={styles.resultActions}>
          {query.sourceKind === 'platform' && (
            <JobSourceFilter field="provider" value={query.providerKey ?? ''} />
          )}
          <JobsRefresh />
        </div>
      </div>
      {page.items.length === 0 ? (
        <section className="empty-state page-empty-state" aria-labelledby="jobs-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ⌕
          </span>
          <h2 id="jobs-empty-title">没有符合条件的职位</h2>
          <p>
            {query.sourceKind === 'platform'
              ? '尝试减少筛选条件，或前往招聘来源获取职位。'
              : '尝试减少筛选条件，或先同步官网来源。'}
          </p>
          <div className="inline-actions">
            <NavigationLink className="button-secondary" href={clearHref}>
              清除筛选
            </NavigationLink>
            <NavigationLink className="button-primary" href={sourcesHref}>
              管理招聘来源
            </NavigationLink>
          </div>
        </section>
      ) : (
        <>
          <JobsTable
            jobs={page.items}
            profileVersionId={query.profileVersionId}
            sort={query.sort}
            direction={query.direction ?? 'desc'}
          />
        </>
      )}
      <Pagination
        total={page.page.total}
        pageSize={page.page.pageSize}
        currentPage={page.page.current}
        totalPages={page.page.totalPages}
        label="职位分页"
        createHref={(pageNumber) => `/jobs${pageHref(parameters, 'page', pageNumber)}`}
      />
    </>
  );
}
