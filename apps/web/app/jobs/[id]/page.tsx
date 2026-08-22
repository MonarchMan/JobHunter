import { JobNotFoundError } from '@jobhunter/application/web';
import { notFound } from 'next/navigation.js';
import type { ReactElement } from 'react';
import { JobStatus } from '../../components/job-status.js';
import { getWebContainer } from '../../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../../src/server/job-query.js';

export const dynamic = 'force-dynamic';

interface JobDetailPageProperties {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<SearchParameterSource>;
}

const dimensionLabels: Readonly<Record<string, string>> = {
  skills: '技能',
  experience: '经验',
  role: '岗位方向',
  industry: '行业',
  location: '地点',
};

const adviceStatusLabels = {
  not_requested: '尚未生成',
  pending: '生成中',
  failed: '生成失败',
} as const;

export default async function JobDetailPage({
  params,
  searchParams,
}: JobDetailPageProperties): Promise<ReactElement> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = firstSearchParameter(query, 'profile');
  const container = await getWebContainer();
  let job: ReturnType<typeof container.services.webJobDetails.get>;
  try {
    job = container.services.webJobDetails.get(id, profile);
  } catch (error) {
    if (error instanceof JobNotFoundError) notFound();
    throw error;
  }
  return (
    <main id="main-content" tabIndex={-1}>
      <a
        className="back-link"
        href={profile ? `/jobs?profile=${encodeURIComponent(profile)}` : '/jobs'}
      >
        ← 返回职位列表
      </a>
      <header className="detail-heading">
        <div>
          <p className="eyebrow">{job.companyName}</p>
          <h1>{job.title}</h1>
          <p>{[job.department, job.jobFamily, ...job.locations].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="detail-actions">
          <JobStatus status={job.status} />
          <a
            className="button-primary"
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            官网投递 ↗
          </a>
          <a
            className="button-secondary"
            href={job.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            官网详情 ↗
          </a>
        </div>
      </header>
      <section className="detail-grid">
        <article className="panel-block">
          <p className="eyebrow">JOB DESCRIPTION</p>
          <h2>职位描述</h2>
          <div className="job-description">{job.description}</div>
          <dl className="facts">
            <div>
              <dt>经验</dt>
              <dd>{job.experienceText ?? '未注明'}</dd>
            </div>
            <div>
              <dt>学历</dt>
              <dd>{job.educationText ?? '未注明'}</dd>
            </div>
            <div>
              <dt>用工类型</dt>
              <dd>{job.employmentType ?? '未注明'}</dd>
            </div>
            <div>
              <dt>最近确认</dt>
              <dd>
                <time dateTime={job.lastSeenAt}>
                  {new Intl.DateTimeFormat('zh-CN').format(new Date(job.lastSeenAt))}
                </time>
              </dd>
            </div>
          </dl>
        </article>
        <aside className="panel-block">
          <p className="eyebrow">REVISION HISTORY</p>
          <h2>修订时间线</h2>
          {job.revisions.length === 0 ? (
            <p className="muted">暂无修订记录。</p>
          ) : (
            <ol className="timeline">
              {job.revisions.map((revision) => (
                <li key={revision.id}>
                  <strong>版本 {revision.revisionNumber}</strong>
                  <time dateTime={revision.createdAt}>
                    {new Intl.DateTimeFormat('zh-CN').format(new Date(revision.createdAt))}
                  </time>
                  <span>
                    {Object.keys(revision.changes).length === 0
                      ? '首次记录'
                      : `变更：${Object.keys(revision.changes).join('、')}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </section>
      <section aria-labelledby="matching-title">
        <div className="section-heading">
          <p className="eyebrow">MATCHING EVIDENCE</p>
          <h2 id="matching-title">匹配与建议</h2>
        </div>
        {job.matches.length === 0 ? (
          <div className="empty-state">
            <h3>尚无匹配结果</h3>
            <p>请先为当前画像执行匹配。</p>
          </div>
        ) : (
          job.matches.map((match) => (
            <article className="match-card" key={match.id}>
              <header>
                <div>
                  <strong>{match.totalScore.toFixed(1)} 分</strong>
                  <span>
                    {match.filterStatus} · 规则集 {match.rulesetVersion}
                  </span>
                </div>
                <small>画像版本 {match.profileVersionId}</small>
              </header>
              <div className="score-grid">
                {match.components.map((component) => (
                  <section key={component.dimension}>
                    <h3>{dimensionLabels[component.dimension] ?? component.dimension}</h3>
                    <strong>
                      {component.score.toFixed(1)} / {component.maximumScore.toFixed(1)}
                    </strong>
                    {component.matchedEvidence.map((evidence) => (
                      <p key={`${evidence.path}:${evidence.summary}`}>✓ {evidence.summary}</p>
                    ))}
                    {component.missingEvidence.map((missing) => (
                      <p className="risk" key={missing}>
                        缺口：{missing}
                      </p>
                    ))}
                    {component.uncertainties.map((uncertain) => (
                      <p className="uncertain" key={uncertain}>
                        待确认：{uncertain}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
              <details>
                <summary>查看资格规则证据</summary>
                <ul className="evidence-list">
                  {match.ruleOutcomes.map((outcome) => (
                    <li key={outcome.ruleId}>
                      <strong>{outcome.status}</strong> {outcome.explanation}
                    </li>
                  ))}
                </ul>
              </details>
              <section className="advice-block">
                <h3>Agent 建议</h3>
                {match.advice.status === 'available' ? (
                  <div className="advice-grid">
                    <div>
                      <h4>亮点</h4>
                      {match.advice.content.highlights.map((point) => (
                        <p key={point.text}>{point.text}</p>
                      ))}
                    </div>
                    <div>
                      <h4>缺口</h4>
                      {match.advice.content.gaps.map((point) => (
                        <p key={point.text}>{point.text}</p>
                      ))}
                    </div>
                    <div>
                      <h4>准备建议</h4>
                      {match.advice.content.preparation.map((point) => (
                        <p key={point}>{point}</p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">{adviceStatusLabels[match.advice.status]}</p>
                )}
              </section>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
