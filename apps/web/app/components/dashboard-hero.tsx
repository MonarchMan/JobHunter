import type { ReactElement } from 'react';
import styles from './dashboard-hero.module.css';

export function DashboardHero(): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="dashboard-title">
      <div className={styles.copy}>
        <h1 id="dashboard-title">
          把下一份工作，
          <em>找得更快。</em>
        </h1>
        <p>从简历画像到官网职位同步，把每一次求职行动集中在一个清晰的工作台里。</p>
        <div className={styles.actions}>
          <a
            className={['button-primary', styles.primaryAction].filter(Boolean).join(' ')}
            href="/profile"
          >
            建立个人资料 <span aria-hidden="true">→</span>
          </a>
          <a className={styles.quietAction} href="/jobs">
            浏览职位 <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className={styles.aside} aria-label="工作台状态">
        <div className={styles.liveStatus}>
          <span className={styles.liveDot} aria-hidden="true" />
          <span>本地工作区</span>
          <strong>已就绪</strong>
        </div>
        <div className={styles.note}>
          <strong>先建立画像，再开始匹配</strong>
          <p>让岗位列表从“有职位”变成“适合你的职位”。</p>
        </div>
      </div>
    </section>
  );
}
