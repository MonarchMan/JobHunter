'use client';

import type { WebSource } from '@jobhunter/application/web';
import { useMemo, useState, type ReactElement } from 'react';
import { CompanyLogo } from '../components/company-logo.js';
import {
  coverageLabels,
  labelStatus,
  supportStatusLabels,
  syncRunStatusLabels,
  syncStatLabels,
} from '../components/status-labels.js';
import { SourceActions, SourceSyncAction } from './source-actions.js';

type RecruitmentChannel = WebSource['recruitmentChannels'][number];
type SelectedChannel = 'all' | RecruitmentChannel;

const channelLabels: Record<RecruitmentChannel, string> = {
  internship: '实习',
  campus: '校招',
  social: '社招',
};

const healthLabels = {
  unknown: '未知',
  healthy: '健康',
  degraded: '退化',
  unhealthy: '异常',
} as const;

const healthWeight: Record<WebSource['healthStatus'], number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unhealthy: 3,
};

function sourceLabel(source: WebSource): string {
  return source.recruitmentChannels.map((channel) => channelLabels[channel]).join(' / ');
}

function SourcePanel({ source }: Readonly<{ source: WebSource }>): ReactElement {
  const label = sourceLabel(source);
  return (
    <section
      className="company-source-view company-source-panel"
      aria-label={`${source.companyName} ${label}来源`}
    >
      <header className="company-source-panel-header">
        <div>
          <p className="source-channel-kicker">{label}渠道</p>
          <h3>{source.enabled ? '自动同步已启用' : '当前来源已停用'}</h3>
          <p className="source-technical-name">{source.slug}</p>
        </div>
        <div className="source-badges">
          <span className={`status health-${source.healthStatus}`}>
            {healthLabels[source.healthStatus]}
          </span>
          <span className={`status support-${source.supportStatus}`}>
            {labelStatus(supportStatusLabels, source.supportStatus)}
          </span>
        </div>
      </header>
      <dl className="facts source-facts">
        <div>
          <dt>连续失败</dt>
          <dd>{source.consecutiveFailures}</dd>
        </div>
        <div>
          <dt>最近成功</dt>
          <dd>
            {source.lastSuccessAt
              ? new Intl.DateTimeFormat('zh-CN').format(new Date(source.lastSuccessAt))
              : '暂无'}
          </dd>
        </div>
        <div>
          <dt>同步计划</dt>
          <dd>
            {source.schedule
              ? `${source.schedule.cronExpression} · ${source.schedule.enabled ? '启用' : '停用'}`
              : '未设置'}
          </dd>
        </div>
        <div>
          <dt>下次执行</dt>
          <dd>
            {source.schedule
              ? new Intl.DateTimeFormat('zh-CN', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(source.schedule.nextRunAt))
              : '—'}
          </dd>
        </div>
      </dl>
      {source.latestRun ? (
        <details className="run-summary">
          <summary>
            最近运行：{labelStatus(syncRunStatusLabels, source.latestRun.status)} /{' '}
            {labelStatus(coverageLabels, source.latestRun.coverage)}
          </summary>
          <dl className="stats-list">
            {Object.entries(source.latestRun.stats).map(([key, value]) => (
              <div key={key}>
                <dt>{labelStatus(syncStatLabels, key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {source.latestRun.errorSummary ? (
            <p className="risk">
              {source.latestRun.errorCategory}: {source.latestRun.errorSummary}
            </p>
          ) : null}
        </details>
      ) : (
        <p className="muted">尚无同步运行。</p>
      )}
      <SourceActions source={source} contextLabel={`${source.companyName} ${label}`} />
    </section>
  );
}

function CompanyOverview({
  companyName,
  sources,
  channels,
}: Readonly<{
  companyName: string;
  sources: readonly WebSource[];
  channels: readonly RecruitmentChannel[];
}>): ReactElement {
  const enabledCount = sources.filter((source) => source.enabled).length;
  const healthyCount = sources.filter((source) => source.healthStatus === 'healthy').length;
  const latestSuccessAt = sources
    .flatMap((source) => (source.lastSuccessAt ? [source.lastSuccessAt] : []))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return (
    <section
      className="company-source-view company-source-overview"
      aria-label={`${companyName}全部渠道总览`}
    >
      <div className="company-overview-intro">
        <p className="source-channel-kicker">全部渠道</p>
        <h3>{channels.map((channel) => channelLabels[channel]).join('、')}已接入</h3>
        <p>选择具体渠道可查看同步运行、统计和计划设置。</p>
      </div>
      <dl className="company-overview-metrics">
        <div>
          <dt>接入渠道</dt>
          <dd>{channels.length}</dd>
        </div>
        <div>
          <dt>启用来源</dt>
          <dd>
            {enabledCount} / {sources.length}
          </dd>
        </div>
        <div>
          <dt>健康来源</dt>
          <dd>
            {healthyCount} / {sources.length}
          </dd>
        </div>
        <div>
          <dt>最近成功</dt>
          <dd>
            {latestSuccessAt
              ? new Intl.DateTimeFormat('zh-CN').format(new Date(latestSuccessAt))
              : '暂无'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function CompanySourceCard({
  sources,
}: Readonly<{ sources: readonly WebSource[] }>): ReactElement {
  const [selected, setSelected] = useState<SelectedChannel>('all');
  const channels = useMemo(
    () =>
      (['internship', 'campus', 'social'] as const).filter((channel) =>
        sources.some((source) => source.recruitmentChannels.includes(channel)),
      ),
    [sources],
  );
  const visibleSources =
    selected === 'all'
      ? sources
      : sources.filter((source) => source.recruitmentChannels.includes(selected));
  const companyName = sources[0]?.companyName ?? '未知公司';
  const showsOverview = selected === 'all' && channels.length > 1;
  const officialUrl = visibleSources[0]?.officialUrl ?? sources[0]?.officialUrl;
  const companyHealth = sources.reduce<WebSource['healthStatus']>(
    (worst, source) =>
      healthWeight[source.healthStatus] > healthWeight[worst] ? source.healthStatus : worst,
    'healthy',
  );
  const syncScopeSource = visibleSources[0] ?? sources[0];
  const syncContextLabel =
    selected === 'all' && channels.length > 1
      ? `${companyName}全部渠道`
      : syncScopeSource
        ? `${companyName}${sourceLabel(syncScopeSource)}`
        : companyName;

  return (
    <article className="source-card company-source-card">
      <header className="company-source-header">
        <div className="company-source-heading-block">
          <div className="company-name-channel-row">
            <CompanyLogo name={companyName} />
            {officialUrl ? (
              <a
                className="company-source-name-link"
                href={officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`打开${companyName}招聘官网`}
              >
                <h2>{companyName}</h2>
              </a>
            ) : (
              <h2>{companyName}</h2>
            )}
            <select
              aria-label={`${companyName}招聘渠道`}
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value as SelectedChannel);
              }}
            >
              <option value="all">全部</option>
              {channels.map((channel) => (
                <option value={channel} key={channel}>
                  {channelLabels[channel]}
                </option>
              ))}
            </select>
          </div>
          <p className="company-source-meta">
            {channels.length} 个已接入渠道 · {sources.length} 个官网来源
          </p>
        </div>
        <div className="company-source-header-actions">
          <SourceSyncAction sources={visibleSources} contextLabel={syncContextLabel} />
          <div className="company-health-summary">
            <span>综合状态</span>
            <strong className={`health-text-${companyHealth}`}>
              {healthLabels[companyHealth]}
            </strong>
          </div>
        </div>
      </header>
      <div className="company-source-panels">
        {showsOverview ? (
          <CompanyOverview companyName={companyName} sources={sources} channels={channels} />
        ) : (
          visibleSources.map((source) => <SourcePanel key={source.id} source={source} />)
        )}
      </div>
    </article>
  );
}
