import type { ReactElement } from 'react';
import type { WebDashboardHighlightJob } from '../../src/shared/dashboard-contracts.js';
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

/** 公司与地点同排展示，标题保留原文，由样式控制视觉宽度和省略。 */
function HighlightJobCard({ job }: Readonly<{ job: WebDashboardHighlightJob }>): ReactElement {
  // 1、保留完整标题与地点，避免按字符截断造成中英文可用宽度不一致。
  return (
    <a href={`/jobs/${job.id}`} className={styles.card}>
      <div className={styles.header}>
        <div className={styles.company}>
          <strong>{job.companyName}</strong>
          {job.isNew ? <span className={styles.newBadge}>新</span> : null}
          {job.locations.length > 0 ? (
            <span className={styles.locations} title={job.locations.join(' · ')}>
              {job.locations.slice(0, 3).join(' · ')}
            </span>
          ) : null}
        </div>
        <time className={styles.time} dateTime={job.publishedAt ?? job.updatedAt}>
          {formatRelativeTime(job.publishedAt ?? job.updatedAt)}
        </time>
      </div>
      <div className={styles.titleRow}>
        <div className={styles.title} title={job.title}>
          {job.title}
        </div>
        {job.score !== null ? (
          <span className={styles.score}>{Math.round(job.score)} 分</span>
        ) : null}
      </div>
      {job.matchReasons.length > 0 ? (
        <div className={styles.reasons}>
          {job.matchReasons.map((reason, idx) => (
            <span key={idx} className={styles.reason}>
              {reason}
            </span>
          ))}
        </div>
      ) : null}
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
