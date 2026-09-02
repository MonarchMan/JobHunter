import type { ReactElement } from 'react';
import type { WebDashboardHighlightJob } from '@jobhunter/application';
import styles from './dashboard-highlight-jobs.module.css';

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = Date.now();
  const diff = now - date.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));

  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days <= 7) return `${String(days)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function HighlightJobCard({ job }: Readonly<{ job: WebDashboardHighlightJob }>): ReactElement {
  return (
    <a href={`/jobs/${job.id}`} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.company}>
          <strong>{job.companyName}</strong>
          {job.isNew ? <span className={styles.newBadge}>新</span> : null}
        </div>
        {job.score !== null ? <span className={styles.score}>{Math.round(job.score)} 分</span> : null}
      </div>
      <div className={styles.title}>{job.title}</div>
      {job.locations.length > 0 ? (
        <div className={styles.locations}>{job.locations.slice(0, 3).join(' · ')}</div>
      ) : null}
      {job.matchReasons.length > 0 ? (
        <div className={styles.reasons}>
          {job.matchReasons.map((reason, idx) => (
            <span key={idx} className={styles.reason}>
              {reason}
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.meta}>
        <time dateTime={job.publishedAt ?? job.updatedAt}>
          {formatRelativeTime(job.publishedAt ?? job.updatedAt)}
        </time>
      </div>
    </a>
  );
}

export function DashboardHighlightJobs({
  jobs,
}: Readonly<{ jobs: readonly WebDashboardHighlightJob[] }>): ReactElement | null {
  if (jobs.length === 0) {
    return null;
  }

  return (
    <section className={styles.container} aria-labelledby="highlight-jobs-title">
      <div className={['section-heading', styles.heading].filter(Boolean).join(' ')}>
        <div>
          <h2 id="highlight-jobs-title">值得关注的职位</h2>
        </div>
        <a className={styles.viewAll} href="/jobs?sort=score_desc">
          查看全部 <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div className={styles.grid}>
        {jobs.map((job) => (
          <HighlightJobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}
