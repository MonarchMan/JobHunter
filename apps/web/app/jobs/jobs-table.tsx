'use client';

import type { WebJobListItem } from '@jobhunter/matching/contracts/web';
import type { MouseEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation.js';
import { JobScoreAction } from './job-score-action.js';
import { JobStatus } from './job-status.js';
import { Icon } from '../components/ui-icon.js';
import { TruncatedText } from '../components/lists/truncated-text.js';
import { CompanyLogo } from '../components/company-logo.js';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import styles from './jobs-table.module.css';
import { scoreBand } from './score-band.js';

const publishedDateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' });

/** 分数链接在桌面和移动端使用一致的契合度档位，同时保留详情入口。 */
function JobScoreLink({
  score,
  href,
  jobTitle,
}: Readonly<{
  score: number | null;
  href: string;
  jobTitle: string;
}>): ReactElement {
  const band = scoreBand(score);
  return (
    <NavigationLink
      className={styles.detailLink}
      href={href}
      data-row-detail-link
      data-score-band={band.key}
      aria-label={`查看职位详情：${jobTitle}`}
      aria-description={band.label}
      title={band.label}
    >
      {score === null ? '无' : `${score.toFixed(1)} 分`}
    </NavigationLink>
  );
}

/** 桌面与移动共用来源发布时间；空值保持未知，不能回退到采集时间。 */
function PublishedDate({ value }: Readonly<{ value: string | null }>): ReactElement {
  // 1、没有来源日期时明确展示缺失，不生成虚假的 time 元素。
  if (value === null) return <span>未提供</span>;
  // 2、沿用中文日期格式，固定时区使服务端与浏览器展示一致。
  return <time dateTime={value}>{publishedDateFormatter.format(new Date(value))}</time>;
}

/** 表格行与移动记录卡的指针增强；真正的链接仍负责键盘和路由语义。 */
function openLinkedRow(event: MouseEvent<HTMLElement>): void {
  // 1、保留子控件、portal、文本选择及浏览器修饰键操作，不吞掉原有行为。
  const target = event.target;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(target instanceof Element) ||
    !event.currentTarget.contains(target) ||
    target.closest(
      'a, button, input, label, select, textarea, summary, [role="button"], [role="link"], [contenteditable], [data-row-navigation-ignore]',
    ) ||
    event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
  )
    return;
  // 2、点击同一行的原生链接而非另造导航；其冒泡会被上面的 a 检查终止。
  event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-detail-link]')?.click();
}

export function JobsTable({
  jobs,
  profileVersionId,
}: Readonly<{
  jobs: readonly WebJobListItem[];
  profileVersionId: string | undefined;
}>): ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const search = useSearchParams().toString();
  /** 保留当前列表条件和评分画像，返回时不丢失用户的筛选上下文。 */
  const detailHref = (jobId: string): string => {
    const query = new URLSearchParams({ returnTo: search ? `/jobs?${search}` : '/jobs' });
    if (profileVersionId) query.set('profile', profileVersionId);
    return `/jobs/${encodeURIComponent(jobId)}?${query.toString()}`;
  };
  const allSelected = jobs.length > 0 && jobs.every((job) => selected.has(job.id));
  const selectedIds = jobs.filter((job) => selected.has(job.id)).map((job) => job.id);

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(jobs.map((job) => job.id)));
  };
  const toggle = (jobId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  return (
    <>
      <div className={styles.selectionToolbar}>
        <label className={styles.mobileSelectAll}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="选择当前页全部职位"
          />
          全选
        </label>
        <span aria-live="polite">已选择 {selectedIds.length} 项</span>
        <JobScoreAction
          jobIds={selectedIds}
          profileVersionId={profileVersionId}
          label={`批量评分（${String(selectedIds.length)}）`}
        />
      </div>
      <div className={styles.tableScroll}>
        <table role="table">
          <caption className="sr-only">可投递职位列表</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col" className={styles.selectionCell}>
                <span className="sr-only">选择职位</span>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="选择当前页全部职位"
                />
              </th>
              <th role="columnheader" scope="col">
                职位
              </th>
              <th role="columnheader" scope="col">
                公司
              </th>
              <th role="columnheader" scope="col">
                地点
              </th>
              <th role="columnheader" scope="col">
                匹配
              </th>
              <th role="columnheader" scope="col">
                发布时间
              </th>
              <th role="columnheader" scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {jobs.map((job) => (
              <tr
                role="row"
                key={job.id}
                className={[styles.linkedRow, job.status === 'stale' ? styles.staleRow : ''].join(
                  ' ',
                )}
                onClick={openLinkedRow}
              >
                <td role="cell" className={styles.selectionCell} data-row-navigation-ignore>
                  <input
                    type="checkbox"
                    checked={selected.has(job.id)}
                    onChange={() => {
                      toggle(job.id);
                    }}
                    aria-label={`选择职位：${job.title}`}
                  />
                </td>
                <td role="cell">
                  <a
                    className={styles.jobLink}
                    href={job.detailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <TruncatedText
                      value={job.title}
                      className="job-title-truncate"
                      focusable={false}
                    />
                  </a>
                  <span className={styles.jobMeta}>
                    {job.department || job.jobSubfamily ? (
                      <span
                        className={styles.department}
                        title={job.department ?? job.jobSubfamily ?? undefined}
                      >
                        {job.department ?? job.jobSubfamily}
                      </span>
                    ) : null}
                    <JobStatus status={job.status} />
                  </span>
                </td>
                <td role="cell">
                  <span className={styles.company}>
                    <CompanyLogo name={job.companyName} size="small" />
                    <TruncatedText value={job.companyName} />
                  </span>
                </td>
                <td role="cell">
                  <TruncatedText
                    value={job.locations.join('、') || '地点未注明'}
                    className="location-truncate"
                  />
                </td>
                <td role="cell">
                  <JobScoreLink score={job.score} href={detailHref(job.id)} jobTitle={job.title} />
                </td>
                <td role="cell">
                  <span className={styles.mobileDateLabel}>发布时间：</span>
                  <PublishedDate value={job.publishedAt} />
                </td>
                <td role="cell">
                  <div className={styles.rowActions} data-row-navigation-ignore>
                    <a
                      className={['button-secondary', styles.applyLink].filter(Boolean).join(' ')}
                      href={job.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="external" />
                      官网投递
                    </a>
                    <JobScoreAction jobIds={[job.id]} profileVersionId={profileVersionId} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
