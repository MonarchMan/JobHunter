import type { ReactElement } from 'react';
import { DashboardHero } from './components/dashboard-hero.js';
import { DashboardSteps } from './components/dashboard-steps.js';
import { MetricCard } from './components/metric-card.js';
import { labelStatus, syncRunStatusLabels } from './components/status-labels.js';
import { getWebContainer } from '../src/server/container.js';
import panelStyles from './dashboard-panel.module.css';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  const dashboard = container.services.dashboard.get();
  const hasSources = dashboard.sources.total > 0;
  const hasJobs = dashboard.activeJobs > 0;

  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <DashboardHero />

      <section className={styles.overview} aria-labelledby="snapshot-title">
        <div className="section-heading">
          <div>
            <h2 id="snapshot-title">工作台概览</h2>
          </div>
          <p className={styles.description}>所有关键进展，都从这里开始。</p>
        </div>
        <div className={styles.metrics} aria-label="核心指标">
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

      <div className={styles.columns}>
        <DashboardSteps hasSources={hasSources} hasJobs={hasJobs} />
        <section
          className={[panelStyles.panel, styles.syncPanel].filter(Boolean).join(' ')}
          aria-labelledby="latest-sync-title"
        >
          <div className={['section-heading', styles.tightHeading].filter(Boolean).join(' ')}>
            <div>
              <h2 id="latest-sync-title">最近同步</h2>
            </div>
            <a className={styles.textLink} href="/sources">
              查看来源 <span aria-hidden="true">↗</span>
            </a>
          </div>
          {dashboard.latestSync ? (
            <div className={styles.syncContent}>
              <span className={styles.syncIcon} aria-hidden="true">
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
              <span
                className={[
                  styles.syncState,
                  dashboard.latestSync.status === 'succeeded'
                    ? undefined
                    : styles.syncNeedsAttention,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {dashboard.latestSync.status === 'succeeded' ? '正常' : '需关注'}
              </span>
            </div>
          ) : (
            <div className={[styles.syncContent, styles.syncEmpty].filter(Boolean).join(' ')}>
              <span className={styles.syncIcon} aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>还没有同步记录</strong>
                <p>启动 Worker 后，从来源页面同步第一批职位。</p>
              </div>
              <a
                className={['button-secondary', styles.emptyAction].filter(Boolean).join(' ')}
                href="/sources"
              >
                去配置来源
              </a>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
