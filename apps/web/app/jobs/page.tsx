import { canonicalJobSubfamilies } from '@jobhunter/domain';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Pagination } from '../components/pagination.js';
import { SelectField } from '../components/select-field.js';
import { JobsRefresh } from './jobs-refresh.js';
import { PageHeader } from '../components/page-header.js';
import { JobsTable } from './jobs-table.js';
import { CompanyCombobox } from '../components/company-combobox.js';
import { getWebContainer } from '../../src/server/container.js';
import {
  firstSearchParameter,
  pageHref,
  parseWebJobQuery,
  type SearchParameterSource,
} from '../../src/server/job-query.js';
import styles from './page.module.css';

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
  const companies = container.services.webSources.list();
  const profiles = container.services.webProfiles.list();
  const defaultProfileId = profiles[0]?.currentVersionId;
  const query = parseWebJobQuery(
    firstSearchParameter(parameters, 'profile') || !defaultProfileId
      ? parameters
      : { ...parameters, profile: defaultProfileId },
  );
  const page = container.services.webJobs.list(query);
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader
        title="职位列表"
        description="默认隐藏已关闭职位。筛选条件会保存在当前 URL 中。"
      />
      <details className={styles.filterPanel} open={hasFilters}>
        <summary>筛选职位{hasFilters ? ' · 已设置条件' : ''}</summary>
        <form
          className={styles.filters}
          action="/jobs"
          method="get"
          aria-label="职位筛选"
          noValidate
        >
          <label>
            招聘类别
            <SelectField
              name="category"
              label="招聘类别"
              defaultValue={fieldValue(parameters, 'category') || 'internship'}
              options={[
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
              companies={companies.map((company) => company.companyName)}
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
              defaultValue={fieldValue(parameters, 'sort') || 'updated_desc'}
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
          <a className="button-secondary" href="/jobs">
            清除
          </a>
        </form>
      </details>
      <div className={styles.resultToolbar}>
        <p className={styles.resultSummary} aria-live="polite">
          当前类别：
          {fieldValue(parameters, 'category') === 'campus'
            ? '校招'
            : fieldValue(parameters, 'category') === 'social'
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
          <p>尝试减少筛选条件，或先同步官网来源。</p>
          <div className="inline-actions">
            <a className="button-secondary" href="/jobs">
              清除筛选
            </a>
            <a className="button-primary" href="/sources">
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
