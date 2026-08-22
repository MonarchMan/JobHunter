import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import { ProfileEditor } from './profile-editor.js';
import { ResumeDeletion } from './resume-deletion.js';

export const dynamic = 'force-dynamic';

interface ProfilePageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

export default async function ProfilePage({
  searchParams,
}: ProfilePageProperties): Promise<ReactElement> {
  const query = await searchParams;
  const container = await getWebContainer();
  const profiles = container.services.webProfiles.list();
  const selectedId = firstSearchParameter(query, 'profile') ?? profiles[0]?.id;
  if (!selectedId) {
    return (
      <main id="main-content" tabIndex={-1}>
        <p className="eyebrow">PROFILE</p>
        <h1>候选人画像</h1>
        <section className="empty-state">
          <h2>尚无画像</h2>
          <p>请先使用 CLI 导入简历并等待画像提取任务完成。</p>
        </section>
      </main>
    );
  }
  const detail = container.services.webProfiles.get(selectedId);
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROFILE</p>
          <h1>候选人画像</h1>
        </div>
        <form action="/profile" method="get">
          <label>
            选择画像
            <select name="profile" defaultValue={selectedId}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">查看</button>
        </form>
      </div>
      <section className="profile-overview">
        <article className="panel-block">
          <p className="eyebrow">CURRENT VERSION</p>
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
          <p className="eyebrow">VERSION HISTORY</p>
          <h2>历史版本</h2>
          <ol className="version-list">
            {detail.versions.map((version) => (
              <li key={version.id}>
                <strong>版本 {version.versionNumber}</strong>
                <time dateTime={version.createdAt}>
                  {new Intl.DateTimeFormat('zh-CN').format(new Date(version.createdAt))}
                </time>
                <span>{version.lockedPaths.length} 个锁定字段</span>
              </li>
            ))}
          </ol>
        </article>
      </section>
      <section className="comparison-grid" aria-label="提取值与有效值">
        <details className="panel-block" open>
          <summary>原提取值</summary>
          <pre tabIndex={0} aria-label="原提取值 JSON">
            {JSON.stringify(detail.current.extracted, null, 2)}
          </pre>
        </details>
        <details className="panel-block" open>
          <summary>当前有效值</summary>
          <pre tabIndex={0} aria-label="当前有效值 JSON">
            {JSON.stringify(detail.current.effective, null, 2)}
          </pre>
        </details>
      </section>
      <ProfileEditor detail={detail} />
      {detail.current.resumeDocumentId ? (
        <ResumeDeletion resumeDocumentId={detail.current.resumeDocumentId} />
      ) : null}
    </main>
  );
}
