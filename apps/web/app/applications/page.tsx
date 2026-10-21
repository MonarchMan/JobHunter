import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHeader } from '../components/layout/page-header.js';
import { CompanyLogo } from '../components/company-logo.js';
import { getWebContainer } from '../../src/server/container.js';
import type { WebApplicationProgress } from '@jobhunter/application/contracts';
import styles from './applications-progress.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '应聘进展' };

const stages = [
  { key: 'applied', label: '投递' },
  { key: 'assessment', label: '测评/笔试' },
  { key: 'interview', label: '面试' },
  { key: 'final', label: 'Offer/结束' },
] as const;

const eventLabels: Readonly<Record<string, string>> = {
  application_acknowledged: '申请已确认',
  assessment_invited: '测评/笔试邀请',
  interview_invited: '面试邀请',
  interview_rescheduled: '面试改期',
  interview_cancelled: '面试取消',
  action_required: '待处理事项',
  process_updated: '流程更新',
  offer_intent: 'Offer 意向',
  offer_issued: '正式 Offer',
  rejected: '流程结束：未通过',
  process_closed: '流程结束',
  other_recruiting: '招聘流程更新',
  not_recruiting: '非招聘邮件',
};

const statusLabels: Readonly<Record<string, string>> = {
  in_progress: '进行中',
  needs_action: '待处理',
  offer: 'Offer',
  closed: '已结束',
  applied: '已投递',
  assessment: '测评/笔试中',
  interview: '面试中',
  offer_intent: 'Offer 意向',
  offered: '已获 Offer',
  rejected: '已结束',
  closed_application: '已结束',
  unknown: '已投递',
};

export default function ApplicationsPage(): ReactElement {
  return (
    <main id="main-content" className={styles.page} tabIndex={-1}>
      <ApplicationsProgressContent />
    </main>
  );
}

/** 应聘进展内容区，供“我的”聚合页复用。 */
export async function ApplicationsProgressContent(): Promise<ReactElement> {
  const container = await getWebContainer();
  const progress = container.services.applications.list();
  return (
    <>
      <PageHeader title="应聘进展">
        <span className={styles.headerHint}>按公司查看岗位流程与面试记录</span>
      </PageHeader>
      {progress.companies.length === 0 ? (
        <section
          className="empty-state page-empty-state"
          aria-labelledby="applications-empty-title"
        >
          <span className="empty-state-icon" aria-hidden="true">
            ◌
          </span>
          <h2 id="applications-empty-title">还没有应聘进展</h2>
          <p>同步招聘邮箱后，申请确认、测评、笔试和面试记录会自动汇总到这里。</p>
          <a className="button-primary" href="/settings">
            去配置邮箱
          </a>
        </section>
      ) : (
        <div className={styles.companyList}>
          {progress.companies.map((company) => (
            <CompanyCard company={company} key={company.key} />
          ))}
        </div>
      )}
    </>
  );
}

function CompanyCard({
  company,
}: {
  readonly company: WebApplicationProgress['companies'][number];
}): ReactElement {
  return (
    <section className={styles.companyCard} aria-labelledby={`company-${company.key}`}>
      <header className={styles.companyHeader}>
        <div className={styles.companyIdentity}>
          <CompanyLogo name={company.companyName} size="medium" />
          <div>
            <h2 id={`company-${company.key}`}>{company.companyName}</h2>
            <p>
              {company.totalApplications} 个岗位 · {company.activeApplications} 个进行中
            </p>
          </div>
        </div>
        <span className={[styles.companyStatus, styles[`status-${company.status}`]].join(' ')}>
          {statusLabels[company.status]}
        </span>
      </header>
      <div className={styles.applicationList}>
        {company.applications.map((application) => (
          <ApplicationRow application={application} key={application.id} />
        ))}
      </div>
    </section>
  );
}

function ApplicationRow({
  application,
}: {
  readonly application: WebApplicationProgress['companies'][number]['applications'][number];
}): ReactElement {
  return (
    <details className={styles.application}>
      <summary className={styles.applicationSummary}>
        <span className={styles.roleBlock}>
          <strong>{application.roleTitle}</strong>
          <span className={styles.roleMeta}>
            {statusLabels[application.status] ?? '流程更新'}
            {application.hasActionRequired ? <em>待处理</em> : null}
          </span>
        </span>
        <span className={styles.summaryAside}>
          {application.rounds.length > 0
            ? `${String(application.rounds.length)} 轮面试`
            : '查看流程'}
          <span className={styles.chevron} aria-hidden="true">
            ⌄
          </span>
        </span>
      </summary>
      <div className={styles.applicationBody}>
        <Pipeline stage={application.stage} />
        {application.rounds.length > 0 ? (
          <section className={styles.rounds} aria-labelledby={`rounds-${application.id}`}>
            <h3 id={`rounds-${application.id}`}>面试时间线</h3>
            <div className={styles.roundList}>
              {application.rounds.map((round) => (
                <div className={styles.round} key={round.key}>
                  <span
                    className={[styles.roundDot, styles[`round-${round.status}`]].join(' ')}
                    aria-hidden="true"
                  />
                  <div className={styles.roundContent}>
                    <strong>{round.label}</strong>
                    <span className={styles.roundStatus}>{roundStatus(round.status)}</span>
                    {round.schedule ? <ScheduleText schedule={round.schedule} /> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className={styles.timeline} aria-labelledby={`timeline-${application.id}`}>
          <h3 id={`timeline-${application.id}`}>申请记录</h3>
          <div className={styles.eventList}>
            {application.events.map((event) => (
              <div className={styles.event} key={event.id}>
                <time dateTime={event.effectiveAt}>{formatDate(event.effectiveAt)}</time>
                <div>
                  <strong>{eventLabels[event.eventType] ?? '流程更新'}</strong>
                  {event.stageLabel ? <span>{event.stageLabel}</span> : null}
                  {event.location ? <span>{event.location}</span> : null}
                  {event.sourceUrl ? (
                    <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                      查看原邮件
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

function Pipeline({
  stage,
}: {
  readonly stage: WebApplicationProgress['companies'][number]['applications'][number]['stage'];
}): ReactElement {
  const currentIndex =
    stage === 'offer' || stage === 'closed' ? 3 : stages.findIndex((item) => item.key === stage);
  return (
    <ol className={styles.pipeline} aria-label="岗位流程">
      {stages.map((item, index) => {
        const complete = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li
            className={[
              complete ? styles.complete : undefined,
              current ? styles.current : undefined,
            ]
              .filter(Boolean)
              .join(' ')}
            key={item.key}
          >
            <span className={styles.pipelineMark}>{complete ? '✓' : current ? '●' : '○'}</span>
            <span>{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ScheduleText({
  schedule,
}: {
  readonly schedule: WebApplicationProgress['companies'][number]['applications'][number]['rounds'][number]['schedule'];
}): ReactElement | null {
  if (!schedule) return null;
  const date = schedule.scheduledStartLocalDate ?? schedule.deadlineLocalDate;
  const time = schedule.scheduledStartAt
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(
        new Date(schedule.scheduledStartAt),
      )
    : null;
  return (
    <span className={styles.schedule}>
      {date ?? '时间待定'}
      {time ? ` · ${time}` : ''}
    </span>
  );
}

function roundStatus(value: string): string {
  return value === 'completed' ? '已完成' : value === 'cancelled' ? '已取消' : '待进行';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
