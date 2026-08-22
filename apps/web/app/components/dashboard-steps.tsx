import type { ReactElement } from 'react';

function Step({
  number,
  title,
  detail,
  complete,
  href,
}: Readonly<{
  number: string;
  title: string;
  detail: string;
  complete: boolean;
  href: string;
}>): ReactElement {
  return (
    <li className={complete ? 'setup-step is-complete' : 'setup-step'}>
      <span className="step-number" aria-hidden="true">
        {complete ? '✓' : number}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {!complete ? (
        <a href={href} aria-label={`前往${title}`}>
          →
        </a>
      ) : null}
    </li>
  );
}

export function DashboardSteps({
  hasSources,
  hasJobs,
}: Readonly<{ hasSources: boolean; hasJobs: boolean }>): ReactElement {
  return (
    <section className="dashboard-panel setup-panel" aria-labelledby="setup-title">
      <div className="section-heading section-heading-tight">
        <div>
          <span className="eyebrow">GET STARTED</span>
          <h2 id="setup-title">三步开始使用</h2>
        </div>
        <span className="section-count">个人工作流</span>
      </div>
      <ol className="setup-list">
        <Step
          number="01"
          title="建立简历画像"
          detail="告诉 Agent 你的经历、偏好与目标。"
          complete={false}
          href="/profile"
        />
        <Step
          number="02"
          title="启用招聘来源"
          detail={hasSources ? '官网来源已准备就绪。' : '选择需要同步的企业官网。'}
          complete={hasSources}
          href="/sources"
        />
        <Step
          number="03"
          title="发现适合的职位"
          detail={hasJobs ? '职位已就绪，可以开始筛选。' : '启动 Worker，同步最新职位。'}
          complete={hasJobs}
          href="/jobs"
        />
      </ol>
    </section>
  );
}
