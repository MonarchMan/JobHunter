import type { ReactElement } from 'react';

export function DashboardHero(): ReactElement {
  return (
    <section className="dashboard-hero" aria-labelledby="dashboard-title">
      <div className="hero-copy">
        <div className="eyebrow hero-eyebrow">
          PERSONAL JOB SEARCH OS <span className="eyebrow-rule" aria-hidden="true" /> LOCAL-FIRST
        </div>
        <h1 id="dashboard-title">
          把下一份工作，
          <em>找得更快。</em>
        </h1>
        <p>从简历画像到官网职位同步，把每一次求职行动集中在一个清晰的工作台里。</p>
        <div className="hero-actions">
          <a className="button-primary button-large" href="/profile">
            建立我的画像 <span aria-hidden="true">→</span>
          </a>
          <a className="button-quiet" href="/jobs">
            浏览职位 <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className="hero-aside" aria-label="工作台状态">
        <div className="live-status">
          <span className="live-dot" aria-hidden="true" />
          <span>本地工作区</span>
          <strong>已就绪</strong>
        </div>
        <div className="hero-note">
          <span className="hero-note-label">NEXT BEST ACTION</span>
          <strong>先建立画像，再开始匹配</strong>
          <p>让岗位列表从“有职位”变成“适合你的职位”。</p>
        </div>
      </div>
    </section>
  );
}
