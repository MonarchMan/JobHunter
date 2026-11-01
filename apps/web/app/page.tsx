import type { ReactElement } from 'react';
import { DashboardHero } from './_dashboard/dashboard-hero.js';
import { TaskDetailsDialog } from './tasks/diagnostic-details.js';
import { DashboardNextAction } from './_dashboard/dashboard-next-action.js';
import { DashboardHighlightJobs } from './_dashboard/dashboard-highlight-jobs.js';
import { DashboardSteps } from './_dashboard/dashboard-steps.js';
import { DashboardResources } from './_dashboard/dashboard-resources.js';
import { MetricCard } from './_dashboard/metric-card.js';
import { DashboardCalendar } from './_dashboard/dashboard-calendar.js';
import {
  addDays,
  calendarGrid,
  dateInTimezone,
  monthStart,
} from './_dashboard/dashboard-calendar-date.js';
import { labelStatus, taskStatusLabels, labelTaskType } from './components/status-labels.js';
import { getWebContainer } from '../src/server/container.js';
import panelStyles from './dashboard-panel.module.css';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<ReactElement> {
  const container = await getWebContainer();
  const dashboard = container.services.dashboard.get();
  const hasSources = dashboard.sources.total > 0;
  const hasJobs = dashboard.activeJobs > 0;
  const activities = container.services.tasks.list({
    statuses: ['succeeded', 'failed', 'cancelled'],
    order: 'finished_desc',
    limit: 8,
  });
  const calendarTimezone = 'Asia/Shanghai';
  const today = dateInTimezone(Date.now(), calendarTimezone);
  const initialMonth = monthStart(today);
  const calendarStart = calendarGrid(initialMonth).dateFrom;
  const calendarEnd = addDays(today, 90);
  const calendar = container.services.calendar.list({
    dateFrom: calendarStart,
    dateTo: calendarEnd,
    timezone: calendarTimezone,
  });

  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <DashboardHero />

      {dashboard.nextAction ? <DashboardNextAction action={dashboard.nextAction} /> : null}

      <DashboardCalendar
        initialItems={calendar.items}
        initialMonth={initialMonth}
        today={today}
        timezone={calendarTimezone}
      />

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
            tone="amber"
          />
        </div>
      </section>

      <DashboardHighlightJobs jobs={dashboard.highlightJobs} />

      <div className={styles.columns}>
        <DashboardSteps
          hasProfile={dashboard.hasProfile}
          hasSources={hasSources}
          hasJobs={hasJobs}
        />
        <section
          className={[panelStyles.panel, styles.syncPanel].filter(Boolean).join(' ')}
          aria-labelledby="latest-sync-title"
        >
          <div className={['section-heading', styles.tightHeading].filter(Boolean).join(' ')}>
            <div>
              <h2 id="latest-sync-title">最近活动</h2>
            </div>
            <a className={styles.textLink} href="/tasks">
              查看任务 <span aria-hidden="true">↗</span>
            </a>
          </div>
          {activities.length ? (
            <ol className={styles.activityList}>
              {activities.map((activity) => {
                const detail = container.services.diagnostics.getTask(activity.id);
                return (
                  <li key={activity.id}>
                    <div>
                      {detail ? (
                        <TaskDetailsDialog task={detail} />
                      ) : (
                        <strong>{labelTaskType(activity.taskType)}</strong>
                      )}
                      <span>{labelStatus(taskStatusLabels, activity.status)}</span>
                      <time
                        dateTime={new Date(activity.finishedAt ?? activity.createdAt).toISOString()}
                      >
                        {new Intl.DateTimeFormat('zh-CN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: 'Asia/Shanghai',
                        }).format(new Date(activity.finishedAt ?? activity.createdAt))}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>暂无活动。任务完成或失败后会显示在这里。</p>
          )}
        </section>
      </div>
      <DashboardResources />
    </main>
  );
}
