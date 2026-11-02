'use client';

import { useSyncExternalStore, useState, type ReactElement } from 'react';
import { Icon } from '../components/ui-icon.js';
import panelStyles from '../dashboard-panel.module.css';
import styles from './dashboard-steps.module.css';

/** 根据真实数据展示单个初始化步骤及未完成时的入口。 */
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
    <li className={[styles.step, complete ? styles.complete : undefined].filter(Boolean).join(' ')}>
      <span className={styles.number} aria-hidden="true">
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

/** 初始化全部完成后默认收起，并优先采用用户保存的展开偏好。 */
export function DashboardSteps({
  hasProfile,
  hasSources,
  hasJobs,
}: Readonly<{ hasProfile: boolean; hasSources: boolean; hasJobs: boolean }>): ReactElement {
  const preference = useSyncExternalStore(subscribe, readPreference, () => null);
  const [manual, setManual] = useState<boolean | null>(null);
  const complete = hasProfile && hasSources && hasJobs;
  const expanded = manual ?? (preference === null ? !complete : preference === 'open');
  /** 用户选择优先于自动折叠，存储失败不阻断当前交互。 */
  function toggle(): void {
    // 1、立即更新交互；2、尽力保存下次访问偏好。
    const next = !expanded;
    setManual(next);
    try {
      localStorage.setItem('dashboard.steps', next ? 'open' : 'closed');
      setManual(null);
      window.dispatchEvent(new Event('dashboard-steps-change'));
    } catch {
      /* 存储禁用时保留会话状态。 */
    }
  }
  return (
    <section className={panelStyles.panel} aria-labelledby="setup-title">
      <div className={['section-heading', styles.heading].filter(Boolean).join(' ')}>
        <div className={styles.titleGroup}>
          <h2 id="setup-title">三步开始使用</h2>
          <button
            type="button"
            className={styles.toggle}
            aria-label={expanded ? '收起引导' : '展开引导'}
            title={expanded ? '收起引导' : '展开引导'}
            aria-expanded={expanded}
            aria-controls="dashboard-setup-steps"
            onClick={toggle}
          >
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={20} />
          </button>
        </div>
      </div>
      {complete ? <p>初始设置已完成</p> : null}
      <ol id="dashboard-setup-steps" className={styles.list} hidden={!expanded}>
        <Step
          number="01"
          title="建立简历画像"
          detail="告诉 Agent 你的经历、偏好与目标。"
          complete={hasProfile}
          href="/my"
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
          detail={hasJobs ? '职位已就绪，可以开始筛选。' : '从来源页面同步最新职位。'}
          complete={hasJobs}
          href="/jobs"
        />
      </ol>
    </section>
  );
}

/** 读取浏览器偏好，服务端以真实完成状态决定默认展开。 */
function readPreference(): string | null {
  try {
    return localStorage.getItem('dashboard.steps');
  } catch {
    return null;
  }
}
/** 同步同窗口操作及其他标签页的折叠偏好。 */
function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener('dashboard-steps-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('dashboard-steps-change', callback);
  };
}
