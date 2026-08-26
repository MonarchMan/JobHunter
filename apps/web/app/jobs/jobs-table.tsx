'use client';

import type { WebJobListItem } from '@jobhunter/application/web';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { JobScoreAction } from '../components/job-score-action.js';
import { JobStatus } from '../components/job-status.js';
import { Icon } from '../components/ui-icon.js';
import { TruncatedText } from '../components/truncated-text.js';
import { CompanyLogo } from '../components/company-logo.js';

export function JobsTable({
  jobs,
  profileVersionId,
}: Readonly<{
  jobs: readonly WebJobListItem[];
  profileVersionId: string | undefined;
}>): ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
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
      <div className="job-selection-toolbar">
        <span aria-live="polite">已选择 {selectedIds.length} 项</span>
        <JobScoreAction
          jobIds={selectedIds}
          profileVersionId={profileVersionId}
          label={`批量评分（${String(selectedIds.length)}）`}
          showHint
        />
      </div>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">可投递职位列表</caption>
          <thead>
            <tr>
              <th scope="col" className="selection-cell">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="选择当前页全部职位"
                />
              </th>
              <th scope="col">职位</th>
              <th scope="col">公司</th>
              <th scope="col">地点</th>
              <th scope="col">匹配</th>
              <th scope="col">更新时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className={job.status === 'stale' ? 'row-stale' : undefined}>
                <td className="selection-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(job.id)}
                    onChange={() => {
                      toggle(job.id);
                    }}
                    aria-label={`选择职位：${job.title}`}
                  />
                </td>
                <td>
                  <a
                    className="job-link"
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
                  <span className="job-row-meta">
                    {job.department ?? job.jobSubfamily ?? null}
                    <JobStatus status={job.status} />
                  </span>
                </td>
                <td>
                  <span className="company-cell">
                    <CompanyLogo name={job.companyName} size="small" />
                    <TruncatedText value={job.companyName} />
                  </span>
                </td>
                <td>
                  <TruncatedText
                    value={job.locations.join('、') || '地点未注明'}
                    className="location-truncate"
                  />
                </td>
                <td>{job.score === null ? '尚未匹配' : `${job.score.toFixed(1)} 分`}</td>
                <td>
                  <time dateTime={job.updatedAt}>
                    {new Intl.DateTimeFormat('zh-CN').format(new Date(job.updatedAt))}
                  </time>
                </td>
                <td>
                  <div className="job-row-actions">
                    <a
                      className="button-secondary job-apply-link"
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
      <div className="job-cards" aria-label="可投递职位卡片列表">
        {jobs.map((job) => (
          <article className="job-card" key={job.id}>
            <div className="job-card-heading">
              <label className="job-card-selection">
                <input
                  type="checkbox"
                  checked={selected.has(job.id)}
                  onChange={() => {
                    toggle(job.id);
                  }}
                />
                <span className="sr-only">选择职位：{job.title}</span>
              </label>
              <a
                className="job-link"
                href={job.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {job.title}
              </a>
              <JobStatus status={job.status} />
            </div>
            <p>
              {job.companyName} · {job.locations.join('、') || '地点未注明'}
            </p>
            <small>
              {job.score === null ? '尚未匹配' : `${job.score.toFixed(1)} 分`} · 更新于{' '}
              {new Intl.DateTimeFormat('zh-CN').format(new Date(job.updatedAt))}
            </small>
            <div className="job-row-actions">
              <a
                className="button-primary job-apply-link"
                href={job.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="external" />
                官网投递
              </a>
              <JobScoreAction jobIds={[job.id]} profileVersionId={profileVersionId} showHint />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
