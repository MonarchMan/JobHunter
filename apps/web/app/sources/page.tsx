import type { ReactElement } from 'react';
import { getWebContainer } from '../../src/server/container.js';
import { firstSearchParameter, type SearchParameterSource } from '../../src/server/job-query.js';
import { SourceActions } from './source-actions.js';
import { SourceTabs, type SourceChannel } from './source-tabs.js';

export const dynamic = 'force-dynamic';

const healthLabels = {
  unknown: '未知',
  healthy: '健康',
  degraded: '退化',
  unhealthy: '异常',
} as const;

interface SourcesPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

export default async function SourcesPage({
  searchParams,
}: SourcesPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const channel: SourceChannel =
    firstSearchParameter(parameters, 'channel') === 'platform' ? 'platform' : 'official';
  const container = await getWebContainer();
  const sources = container.services.webSources.list();
  const officialSources = channel === 'official' ? sources : [];
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">RECRUITMENT SOURCES</p>
          <h1>招聘来源</h1>
        </div>
        <p>按来源类型管理职位同步。操作仅创建后台任务，页面请求不会执行采集或健康检查。</p>
      </div>
      <SourceTabs active={channel} officialCount={sources.length} />
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
      ) : officialSources.length === 0 ? (
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
        <div className="source-list">
          {officialSources.map((source) => (
            <article className="source-card" key={source.id}>
              <header>
                <div>
                  <p className="eyebrow">{source.adapterKey}</p>
                  <h2>{source.companyName}</h2>
                  <span>{source.slug}</span>
                </div>
                <div className="source-badges">
                  <span className={`status health-${source.healthStatus}`}>
                    {healthLabels[source.healthStatus]}
                  </span>
                  <span className="status">{source.supportStatus}</span>
                  <span className="status">{source.enabled ? '已启用' : '已停用'}</span>
                </div>
              </header>
              <dl className="facts source-facts">
                <div>
                  <dt>连续失败</dt>
                  <dd>{source.consecutiveFailures}</dd>
                </div>
                <div>
                  <dt>最近成功</dt>
                  <dd>
                    {source.lastSuccessAt
                      ? new Intl.DateTimeFormat('zh-CN').format(new Date(source.lastSuccessAt))
                      : '无'}
                  </dd>
                </div>
                <div>
                  <dt>同步计划</dt>
                  <dd>
                    {source.schedule
                      ? `${source.schedule.cronExpression} · ${source.schedule.enabled ? '启用' : '停用'}`
                      : '未设置'}
                  </dd>
                </div>
                <div>
                  <dt>下次执行</dt>
                  <dd>
                    {source.schedule
                      ? new Intl.DateTimeFormat('zh-CN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(source.schedule.nextRunAt))
                      : '—'}
                  </dd>
                </div>
              </dl>
              {source.latestRun ? (
                <details className="run-summary">
                  <summary>
                    最近运行：{source.latestRun.status} / {source.latestRun.coverage}
                  </summary>
                  <dl className="stats-list">
                    {Object.entries(source.latestRun.stats).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {source.latestRun.errorSummary ? (
                    <p className="risk">
                      {source.latestRun.errorCategory}: {source.latestRun.errorSummary}
                    </p>
                  ) : null}
                </details>
              ) : (
                <p className="muted">尚无同步运行。</p>
              )}
              <SourceActions source={source} />
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
