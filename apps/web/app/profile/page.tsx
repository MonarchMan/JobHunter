import { ExtractionReviewEntry } from './profile-on-demand.js';
import { ResumeEditor } from './resume-editor.js';
import { listPageSize } from '../../src/server/job-query.js';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeader } from '../components/layout/page-header.js';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import { getWebContainer } from '../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import { ProfileEditor } from './profile-editor.js';
import { ResumeDeletion } from './resume-deletion.js';
import { ResumeImport } from './resume-import.js';
import { Pagination } from '../components/lists/pagination.js';
import { webPagination } from '@jobhunter/common/web-contracts';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '个人资料' };

interface ProfilePageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
  readonly embedded?: boolean;
}

export default async function ProfilePage({
  searchParams,
  embedded = false,
}: ProfilePageProperties): Promise<ReactElement> {
  const Container = embedded ? 'div' : 'main';
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
      <Container id={embedded ? undefined : 'main-content'} tabIndex={embedded ? undefined : -1}>
        {!embedded ? <PageHeader title="个人资料" /> : null}
        <ResumeImport />
        <section className="empty-state page-empty-state" aria-labelledby="profile-empty-title">
          <span className="empty-state-icon" aria-hidden="true">
            ◎
          </span>
          <h2 id="profile-empty-title">尚无个人资料</h2>
          <p>导入简历后，后台会提取个人资料并生成可匹配的求职意向。</p>
          <div className="inline-actions">
            <NavigationLink className="button-primary" href="/">
              返回工作台
            </NavigationLink>
            <NavigationLink className="button-secondary" href="/jobs">
              先浏览职位
            </NavigationLink>
          </div>
        </section>
      </Container>
    );
  }
  const selectedProfile = profiles.find((profile) => profile.id === selectedId);
  if (!selectedProfile?.currentVersionId) {
    return (
      <Container id={embedded ? undefined : 'main-content'} tabIndex={embedded ? undefined : -1}>
        {!embedded ? <PageHeader title="个人资料" /> : null}
        {selectedProfile ? <ResumeImport profileId={selectedProfile.id} /> : <ResumeImport />}
        <section className="empty-state page-empty-state" aria-labelledby="profile-pending-title">
          <span className="empty-state-icon" aria-hidden="true">
            ◌
          </span>
          <h2 id="profile-pending-title">个人资料待提取</h2>
          {selectedProfile ? <p>当前档案：{selectedProfile.name}</p> : null}
          <p>简历已保存，个人资料尚未提取成功。可在任务页查看提取状态或重试失败任务。</p>
          <div className="inline-actions">
            <NavigationLink className="button-secondary" href="/tasks?type=resume.profile.extract">
              查看提取任务
            </NavigationLink>
          </div>
        </section>
      </Container>
    );
  }
  const detail = container.services.webProfiles.get(selectedId);
  const candidate = detail.versions.find(
    (version) => version.isCandidate && version.baseVersionId === detail.current.id,
  );
  const effective = detail.current.effective;
  const versionPagination = webPagination(
    detail.versions.length,
    versionPageNumber,
    listPageSize(query),
  );
  const visibleVersions = detail.versions.slice(
    (versionPagination.current - 1) * versionPagination.pageSize,
    versionPagination.current * versionPagination.pageSize,
  );
  return (
    <Container id={embedded ? undefined : 'main-content'} tabIndex={embedded ? undefined : -1}>
      {!embedded ? <PageHeader title="个人资料" /> : null}
      <ResumeImport profileId={detail.profile.id} />
      <ResumeEditor
        key={detail.current.id}
        profileId={detail.profile.id}
        versionId={detail.current.id}
        profile={effective}
      />
      <section className={styles.overview} data-profile-overview>
        <article className="panel-block">
          <h2>版本 {detail.current.versionNumber}</h2>
          <dl className="facts">
            {effective.basicInfo.name ? (
              <div>
                <dt>姓名</dt>
                <dd>{effective.basicInfo.name}</dd>
              </div>
            ) : null}
            {effective.targetRoles.length ? (
              <div>
                <dt>岗位方向</dt>
                <dd>{effective.targetRoles.join('、')}</dd>
              </div>
            ) : null}
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
              <dd>{detail.current.extractionAgent ? detail.current.extractionAgent.key : '无'}</dd>
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
                <span>{version.isCandidate ? '待确认提取' : '已确认'}</span>
              </li>
            ))}
          </ol>
          <Pagination
            total={versionPagination.total}
            pageSize={versionPagination.pageSize}
            currentPage={versionPagination.current}
            totalPages={versionPagination.totalPages}
            label="画像版本分页"
            createHref={(page) => {
              const parameters = new URLSearchParams({
                profile: selectedId,
                page: String(page),
                pageSize: String(versionPagination.pageSize),
              });
              return `${embedded ? '/my?tab=profile&' : '/profile?'}${parameters.toString()}`;
            }}
          />
        </article>
      </section>
      {candidate ? (
        <ExtractionReviewEntry
          key={candidate.id}
          profileId={detail.profile.id}
          current={detail.current}
          candidate={candidate}
        />
      ) : null}
      <section className={styles.comparison} data-profile-comparison aria-label="当前画像">
        <details className="panel-block developer-details">
          <summary>开发者详情：当前有效值 JSON</summary>
          <pre tabIndex={0} aria-label="当前有效值 JSON">
            {JSON.stringify(detail.current.effective, null, 2)}
          </pre>
        </details>
      </section>
      <details className="panel-block developer-details profile-advanced-tools">
        <summary>高级维护：JSON 修正</summary>
        <ProfileEditor detail={detail} />
      </details>
      {detail.current.resumeDocumentId ? (
        <ResumeDeletion resumeDocumentId={detail.current.resumeDocumentId} />
      ) : null}
    </Container>
  );
}
