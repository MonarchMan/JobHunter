'use client';

import type { WebSource, WebSourceChannel } from '@jobhunter/application/web';
import { useMemo, useState, type ReactElement } from 'react';
import { CompanyLogo } from '../components/company-logo.js';
import {
  coverageLabels,
  labelStatus,
  supportStatusLabels,
  syncRunStatusLabels,
  syncStatLabels,
} from '../components/status-labels.js';
import { SourceActions, SourceChannelSyncAction, SourceChannelToggle } from './source-actions.js';
import styles from './company-source-card.module.css';

function classNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

type RecruitmentChannel = WebSourceChannel['channel'];
type SelectedChannel = 'all' | RecruitmentChannel;

const channelLabels: Record<RecruitmentChannel, string> = {
  intern: '实习',
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

function SourcePanel({
  source,
  channel,
  syncReady,
}: Readonly<{
  source: WebSource;
  channel: RecruitmentChannel;
  syncReady: boolean;
}>): ReactElement {
  const label = channelLabels[channel];
  return (
    <section
      className={classNames(styles['company-source-view'], styles['company-source-panel'])}
      data-company-source-panel
      aria-label={`${source.companyName} ${label}来源`}
    >
      <header className={styles['company-source-panel-header']}>
        <div>
          <p className={styles['source-channel-kicker']}>{label}渠道</p>
          <h3>
            {source.effectiveEnabled
              ? '当前同步已启用'
              : source.enabled
                ? '当前同步渠道未选中'
                : '当前来源已停用'}
          </h3>
          <p className={styles['source-technical-name']}>{source.slug}</p>
        </div>
        <div className={styles['source-badges']}>
          <span className={classNames('status', styles[`health-${source.healthStatus}`])}>
            {healthLabels[source.healthStatus]}
          </span>
          <span className={classNames('status', styles[`support-${source.supportStatus}`])}>
            {labelStatus(supportStatusLabels, source.supportStatus)}
          </span>
        </div>
      </header>
      <dl className={classNames('facts', styles['source-facts'])} data-source-facts>
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
        <details className={styles['run-summary']}>
          <summary>
            最近运行：{labelStatus(syncRunStatusLabels, source.latestRun.status)} /{' '}
            {labelStatus(coverageLabels, source.latestRun.coverage)}
          </summary>
          <dl className={styles['stats-list']}>
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
      <SourceActions
        source={source}
        syncReady={syncReady}
        contextLabel={`${source.companyName} ${label}`}
      />
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
  channels: readonly WebSourceChannel[];
}>): ReactElement {
  const enabledCount = sources.filter((source) => source.effectiveEnabled).length;
  const healthyCount = sources.filter((source) => source.healthStatus === 'healthy').length;
  const latestSuccessAt = sources
    .flatMap((source) => (source.lastSuccessAt ? [source.lastSuccessAt] : []))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return (
    <section
      className={classNames(styles['company-source-view'], styles['company-source-overview'])}
      aria-label={`${companyName}全部渠道总览`}
    >
      <div className={styles['company-overview-intro']}>
        <p className={styles['source-channel-kicker']}>全部渠道</p>
        <h3>{channels.map((channel) => channelLabels[channel.channel]).join('、')}渠道</h3>
        <p>选择具体渠道可查看同步运行、统计和计划设置。</p>
      </div>
      <dl className={styles['company-overview-metrics']}>
        <div>
          <dt>接入渠道</dt>
          <dd>{channels.length}</dd>
        </div>
        <div>
          <dt>当前同步来源</dt>
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
  channels,
  syncReady,
  activeSyncChannel,
}: Readonly<{
  channels: readonly WebSourceChannel[];
  syncReady: boolean;
  activeSyncChannel: RecruitmentChannel;
}>): ReactElement {
  const [selected, setSelected] = useState<SelectedChannel>('all');
  const sources = useMemo(() => channels.flatMap((channel) => channel.sources), [channels]);
  const selectedChannel =
    selected === 'all' ? null : (channels.find((channel) => channel.channel === selected) ?? null);
  const visibleSources = selectedChannel ? selectedChannel.sources : sources;
  const visibleChannels = selectedChannel ? [selectedChannel] : channels;
  const companyName = channels[0]?.companyName ?? '未知公司';
  const showsOverview = selected === 'all';
  const officialUrl = visibleSources[0]?.officialUrl ?? sources[0]?.officialUrl;
  const companyHealth = sources.reduce<WebSource['healthStatus']>(
    (worst, source) =>
      healthWeight[source.healthStatus] > healthWeight[worst] ? source.healthStatus : worst,
    'healthy',
  );
  const syncContextLabel =
    selected === 'all'
      ? `${companyName}全部渠道`
      : selectedChannel
        ? `${companyName}${channelLabels[selectedChannel.channel]}`
        : companyName;

  return (
    <article
      className={classNames(
        styles['company-source-card'],
        styles[`company-health-${companyHealth}`],
      )}
      data-company-source-card
      data-health-status={companyHealth}
    >
      <header className={styles['company-source-header']} data-company-source-header>
        <div className={styles['company-source-heading-block']}>
          <div className={styles['company-name-row']} data-company-name-row>
            <CompanyLogo name={companyName} variant="source-heading" />
            {officialUrl ? (
              <a
                className={styles['company-source-name-link']}
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
          </div>
          <p className={styles['company-source-meta']}>
            {channels.length} 个逻辑渠道 · {sources.length} 个物理来源
          </p>
        </div>
        <div
          className={styles['company-sync-channel']}
          data-company-sync-channel={activeSyncChannel}
        >
          <span className="sr-only">同步招聘渠道：</span>
          <strong>{channelLabels[activeSyncChannel]}</strong>
        </div>
        <div className={styles['company-source-controls']} data-company-source-controls>
          <label className={styles['company-channel-selector']} data-company-channel-selector>
            <span>招聘渠道</span>
            <select
              aria-label={`${companyName}招聘渠道`}
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value as SelectedChannel);
              }}
            >
              <option value="all">全部</option>
              {channels.map((channel) => (
                <option value={channel.channel} key={channel.id}>
                  {channelLabels[channel.channel]}
                </option>
              ))}
            </select>
          </label>
          <div
            className={styles['company-source-header-actions']}
            data-company-source-header-actions
          >
            <SourceChannelSyncAction
              channels={visibleChannels}
              contextLabel={syncContextLabel}
              syncReady={syncReady}
            />
            {selectedChannel ? <SourceChannelToggle channel={selectedChannel} /> : null}
          </div>
        </div>
      </header>
      <div className={styles['company-source-panels']} data-company-source-panels>
        {showsOverview ? (
          <CompanyOverview companyName={companyName} sources={sources} channels={channels} />
        ) : selectedChannel?.sources.length === 0 ? (
          <section className={styles['company-source-view']}>
            <p className={styles['source-channel-kicker']}>
              {channelLabels[selectedChannel.channel]}渠道
            </p>
            <h3>暂无可执行的官网来源</h3>
            <p className="muted">
              {selectedChannel.supportNote ?? '该渠道当前处于 blocked 状态。'}
            </p>
          </section>
        ) : (
          visibleSources.map((source) => (
            <SourcePanel
              key={source.id}
              source={source}
              channel={selectedChannel?.channel ?? 'campus'}
              syncReady={syncReady}
            />
          ))
        )}
      </div>
    </article>
  );
}
