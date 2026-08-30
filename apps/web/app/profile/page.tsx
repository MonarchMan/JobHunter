import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { PageHeader } from '../components/page-header.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import { ProfileEditor } from './profile-editor.js';
import { ResumeDeletion } from './resume-deletion.js';
import { ResumeImport } from './resume-import.js';
import { Pagination } from '../components/pagination.js';
import { SelectField } from '../components/select-field.js';
import { webPagination } from '@jobhunter/application/web';
import { ResumeEditor } from './resume-editor.js';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '个人资料' };

interface ProfilePageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

export default async function ProfilePage({
  searchParams,
}: ProfilePageProperties): Promise<ReactElement> {
  const query = await searchParams;
  const container = await getWebContainer();
  const profiles = container.services.webProfiles.list();
  const requestedVersionPage = Number(firstSearchParameter(query, 'page') ?? '1');
  const versionPageNumber =
    Number.isSafeInteger(requestedVersionPage) && requestedVersionPage > 0
      ? requestedVersionPage
      : 1;
  const selectedId = firstSearchParameter(query, 'profile') ?? profiles[0]?.id;
  if (!selectedId) {
    return (
      <main id="main-content" tabIndex={-1}>
        <PageHeader title="个人资料" />
        <ResumeImport />
        <section className="empty-state page-empty-state" aria-labelledby="profile-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ◎
          </span>
          <h2 id="profile-empty-title">尚无个人资料</h2>
          <p>导入简历后，后台会提取个人资料并生成可匹配的求职意向。</p>
          <div className="inline-actions">
            <a className="button-primary" href="/">
              返回工作台
            </a>
            <a className="button-secondary" href="/jobs">
              先浏览职位
            </a>
          </div>
        </section>
      </main>
    );
  }
  const selectedProfile = profiles.find((profile) => profile.id === selectedId);
  if (!selectedProfile?.currentVersionId) {
    return (
      <main id="main-content" tabIndex={-1}>
        <PageHeader title="个人资料" />
        {selectedProfile ? <ResumeImport profileId={selectedProfile.id} /> : <ResumeImport />}
        <section className="empty-state page-empty-state" aria-labelledby="profile-pending-title">
          <span className="empty-state-icon" aria-hidden="true">
            ◌
          </span>
          <h2 id="profile-pending-title">个人资料正在生成</h2>
          <p>简历已保存，等待 Worker 完成后台提取任务后刷新此页面。</p>
        </section>
      </main>
    );
  }
  const detail = container.services.webProfiles.get(selectedId);
  const versionPagination = webPagination(detail.versions.length, versionPageNumber, 10);
  const visibleVersions = detail.versions.slice(
    (versionPagination.current - 1) * versionPagination.pageSize,
    versionPagination.current * versionPagination.pageSize,
  );
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader title="个人资料">
        <form action="/profile" method="get" noValidate>
          <label>
            选择画像
            <SelectField
              name="profile"
              label="选择画像"
              defaultValue={selectedId}
              options={profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
              }))}
            />
          </label>
          <button type="submit">查看</button>
        </form>
      </PageHeader>
      <ResumeImport profileId={detail.profile.id} />
      <ResumeEditor
        profileId={detail.profile.id}
        versionId={detail.current.id}
        profile={detail.current.effective}
      />
      <section className={styles.overview} data-profile-overview>
        <article className="panel-block">
          <h2>版本 {detail.current.versionNumber}</h2>
          <dl className="facts">
            <div>
              <dt>版本 ID</dt>
              <dd>
                <code>{detail.current.id}</code>
              </dd>
            </div>
            <div>
              <dt>来源简历</dt>
              <dd>{detail.current.resumeDocumentId ?? '人工创建/未知'}</dd>
            </div>
            <div>
              <dt>提取 Agent</dt>
              <dd>
                {detail.current.extractionAgent
                  ? `${detail.current.extractionAgent.key} ${detail.current.extractionAgent.version}`
                  : '无'}
              </dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>
                <time dateTime={detail.current.createdAt}>
                  {new Intl.DateTimeFormat('zh-CN').format(new Date(detail.current.createdAt))}
                </time>
              </dd>
            </div>
          </dl>
        </article>
        <article className="panel-block">
          <h2>历史版本</h2>
          <ol className={styles.versionList}>
            {visibleVersions.map((version) => (
              <li key={version.id}>
                <strong>版本 {version.versionNumber}</strong>
                <time dateTime={version.createdAt}>
                  {new Intl.DateTimeFormat('zh-CN').format(new Date(version.createdAt))}
                </time>
                <span>{version.lockedPaths.length} 个锁定字段</span>
              </li>
            ))}
          </ol>
          <Pagination
            currentPage={versionPagination.current}
            totalPages={versionPagination.totalPages}
            label="画像版本分页"
            createHref={(page) => {
              const parameters = new URLSearchParams({ profile: selectedId, page: String(page) });
              return `/profile?${parameters.toString()}`;
            }}
          />
        </article>
      </section>
      <section className={styles.comparison} data-profile-comparison aria-label="提取值与有效值">
        <details className="panel-block developer-details">
          <summary>开发者详情：原提取值 JSON</summary>
          <pre tabIndex={0} aria-label="原提取值 JSON">
            {JSON.stringify(detail.current.extracted, null, 2)}
          </pre>
        </details>
        <details className="panel-block developer-details">
          <summary>开发者详情：当前有效值 JSON</summary>
          <pre tabIndex={0} aria-label="当前有效值 JSON">
            {JSON.stringify(detail.current.effective, null, 2)}
          </pre>
        </details>
      </section>
      <details className="panel-block developer-details profile-advanced-tools">
        <summary>高级维护：字段锁定与 JSON 修正</summary>
        <ProfileEditor detail={detail} />
      </details>
      {detail.current.resumeDocumentId ? (
        <ResumeDeletion resumeDocumentId={detail.current.resumeDocumentId} />
      ) : null}
    </main>
  );
}
