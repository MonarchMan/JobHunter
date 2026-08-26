import type { ReactElement } from 'react';
import { DashboardHero } from './components/dashboard-hero.js';
import { DashboardSteps } from './components/dashboard-steps.js';
import { MetricCard } from './components/metric-card.js';
import { labelStatus, syncRunStatusLabels } from './components/status-labels.js';
import { getWebContainer } from '../src/server/container.js';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  const dashboard = container.services.dashboard.get();
  const hasSources = dashboard.sources.total > 0;
  const hasJobs = dashboard.activeJobs > 0;

  return (
    <main id="main-content" className="dashboard-page" tabIndex={-1}>
      <DashboardHero />

      <section className="dashboard-section" aria-labelledby="snapshot-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">AT A GLANCE</span>
            <h2 id="snapshot-title">工作台概览</h2>
          </div>
          <p className="section-description">所有关键进展，都从这里开始。</p>
        </div>
        <div className="metric-grid" aria-label="核心指标">
          <MetricCard
            label="在招职位"
            value={dashboard.activeJobs}
            detail="当前可申请职位"
            href="/jobs"
            tone="primary"
          />
          <MetricCard
            label="当前匹配"
            value={dashboard.currentMatches}
            detail="排除项之外"
            href="/jobs?sort=score_desc"
            tone="violet"
          />
          <MetricCard
            label="来源健康"
            value={`${String(dashboard.sources.healthy)}/${String(dashboard.sources.total)}`}
            detail="已启用官网来源"
            href="/sources"
            tone="blue"
          />
          <MetricCard
            label="待办任务"
            value={dashboard.tasks.pending}
            detail={`${String(dashboard.tasks.failed)} 个失败任务`}
            href="/tasks"
            tone={dashboard.tasks.failed > 0 ? 'amber' : 'primary'}
          />
        </div>
      </section>

      <div className="dashboard-columns">
        <DashboardSteps hasSources={hasSources} hasJobs={hasJobs} />
        <section className="dashboard-panel sync-panel" aria-labelledby="latest-sync-title">
          <div className="section-heading section-heading-tight">
            <div>
              <span className="eyebrow">ACTIVITY</span>
              <h2 id="latest-sync-title">最近同步</h2>
            </div>
            <a className="text-link" href="/sources">
              查看来源 <span aria-hidden="true">↗</span>
            </a>
          </div>
          {dashboard.latestSync ? (
            <div className="sync-summary">
              <span className="sync-icon" aria-hidden="true">
                ↻
              </span>
              <div>
                <strong>{dashboard.latestSync.sourceName}</strong>
                <p>
                  {labelStatus(syncRunStatusLabels, dashboard.latestSync.status)} ·{' '}
                  <time dateTime={dashboard.latestSync.finishedAt}>
                    {new Intl.DateTimeFormat('zh-CN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(dashboard.latestSync.finishedAt))}
                  </time>
                </p>
              </div>
              <span className={`sync-state sync-${dashboard.latestSync.status}`}>
                {dashboard.latestSync.status === 'succeeded' ? '正常' : '需关注'}
              </span>
            </div>
          ) : (
            <div className="sync-empty">
              <span className="empty-orbit" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>还没有同步记录</strong>
                <p>启动 Worker 后，从来源页面同步第一批职位。</p>
              </div>
              <a className="button-secondary" href="/sources">
                去配置来源
              </a>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
