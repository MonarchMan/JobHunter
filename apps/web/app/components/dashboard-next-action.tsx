import type { ReactElement } from 'react';
import type { WebDashboardNextAction } from '@jobhunter/application';
import styles from './dashboard-next-action.module.css';

export function DashboardNextAction({
  action,
}: Readonly<{ action: WebDashboardNextAction }>): ReactElement {
  if (action.type === 'all_good') {
    return (
      <section className={styles.container} aria-labelledby="next-action-title">
        <div className={styles.goodState}>
          <span className={styles.icon} aria-hidden="true">
            ✓
          </span>
          <div>
            <h2 id="next-action-title" className={styles.title}>
              运行正常
            </h2>
            <p className={styles.message}>{action.message}</p>
          </div>
        </div>
      </section>
    );
  }

  const renderContent = (): ReactElement | null => {
    switch (action.type) {
      case 'create_profile':
      case 'enable_sources':
        return (
          <>
            <span className={styles.cursorIcon} aria-hidden="true">
              ▎
            </span>
            <div className={styles.content}>
              <h2 id="next-action-title" className={styles.title}>
                下一步
              </h2>
              <p className={styles.message}>{action.message}</p>
            </div>
            <a className={styles.action} href={action.href}>
              前往 <span aria-hidden="true">→</span>
            </a>
          </>
        );

      case 'handle_failures':
        return (
          <>
            <span className={styles.cursorIcon} aria-hidden="true">
              ▎
            </span>
            <div className={styles.content}>
              <h2 id="next-action-title" className={styles.title}>
                需要处理
              </h2>
              <p className={styles.message}>{action.message}</p>
            </div>
            <a className={styles.action} href={action.href}>
              查看任务 <span aria-hidden="true">→</span>
            </a>
          </>
        );

      case 'review_matches':
        return (
          <>
            <span className={styles.cursorIcon} aria-hidden="true">
              ▎
            </span>
            <div className={styles.content}>
              <h2 id="next-action-title" className={styles.title}>
                下一步
              </h2>
              <p className={styles.message}>{action.message}</p>
              {action.topJob ? (
                <div className={styles.topJobPreview}>
                  <strong>{action.topJob.companyName}</strong>
                  <span className={styles.separator}>·</span>
                  {action.topJob.title}
                  <span className={styles.separator}>·</span>
                  <span className={styles.score}>{action.topJob.score} 分</span>
                </div>
              ) : null}
            </div>
            <a className={styles.action} href={action.href}>
              查看 <span aria-hidden="true">→</span>
            </a>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <section className={styles.container} aria-labelledby="next-action-title">
      <div className={styles.actionState}>{renderContent()}</div>
    </section>
  );
}
