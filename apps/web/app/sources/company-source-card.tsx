'use client';

import type { WebSource, WebSourceChannel } from '@jobhunter/recruitment/contracts/web';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Icon } from '../components/ui-icon.js';
import { SourceScheduleEditor } from './source-schedule-editor.js';
import { scheduleLabel } from './schedule-label.js';
import { sourceName } from './source-name.js';
import { CompanyLogo } from '../components/company-logo.js';
import { SelectField } from '../components/forms/select-field.js';
import {
  coverageLabels,
  labelStatus,
  supportStatusLabels,
  syncRunStatusLabels,
  syncStatLabels,
} from '../components/status-labels.js';
import {
  SourceHealthAction,
  SourceChannelSyncAction,
  SourceChannelToggle,
} from './source-actions.js';
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

/** 按最差成员状态聚合当前视图的运行健康，空渠道保持未知。 */
function aggregateHealth(sources: readonly WebSource[]): WebSource['healthStatus'] {
  if (sources.length === 0) return 'unknown';
  return sources.reduce<WebSource['healthStatus']>(
    (worst, source) =>
      healthWeight[source.healthStatus] > healthWeight[worst] ? source.healthStatus : worst,
    'healthy',
  );
}

function SourcePanel({
  source,
  channel,
  syncReady,
  channelInfo,
  detailed = false,
}: Readonly<{
  source: WebSource;
  channel: RecruitmentChannel;
  syncReady: boolean;
  channelInfo?: WebSourceChannel;
  detailed?: boolean;
}>): ReactElement {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = channelLabels[channel];
  const officialLink = (
    <a
      className={styles['source-official-link']}
      href={source.officialUrl}
      title={source.officialUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {sourceName(source, channel)}
    </a>
  );
  return (
    <section
      className={classNames(styles['company-source-view'], styles['company-source-panel'])}
      data-company-source-panel={detailed ? undefined : ''}
      aria-label={`${source.companyName} ${label}来源`}
    >
      <header
        className={classNames(
          styles['company-source-panel-header'],
          detailed && styles.detailHeading,
        )}
      >
        <div>{detailed ? <h2>{officialLink}</h2> : officialLink}</div>
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
          <dt>同步计划</dt>
          <dd>
            {detailed ? (
              <SourceScheduleEditor source={source} syncReady={syncReady} />
            ) : source.schedule?.enabled ? (
              scheduleLabel(source.schedule.cronExpression)
            ) : (
              '无'
            )}
          </dd>
        </div>
        {detailed ? (
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
        ) : null}
        <div>
          <dt>最近成功</dt>
          <dd>
            {source.lastSuccessAt
              ? new Intl.DateTimeFormat('zh-CN').format(new Date(source.lastSuccessAt))
              : '暂无'}
          </dd>
        </div>
        {detailed ? (
          <div>
            <dt>连续失败</dt>
            <dd>{source.consecutiveFailures}</dd>
          </div>
        ) : null}
      </dl>
      {detailed ? (
        <>
          {source.latestRun ? (
            <section className={styles['run-summary']} aria-label="最近同步">
              <h3>
                最近运行：{labelStatus(syncRunStatusLabels, source.latestRun.status)} /{' '}
                {labelStatus(coverageLabels, source.latestRun.coverage)}
              </h3>
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
            </section>
          ) : (
            <p className="muted">尚无同步运行。</p>
          )}
          <footer className={styles.dialogFooter}>
            <SourceHealthAction source={source} contextLabel={`${source.companyName} ${label}`} />
            {channelInfo ? <SourceChannelToggle channel={channelInfo} /> : null}
          </footer>
        </>
      ) : (
        <>
          <button
            ref={trigger}
            type="button"
            className="button-link"
            onClick={() => {
              setOpen(true);
            }}
          >
            查看详情
          </button>
          {open ? (
            <SourceDetails
              onClose={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <SourcePanel
                source={source}
                channel={channel}
                syncReady={syncReady}
                {...(channelInfo ? { channelInfo } : {})}
                detailed
              />
            </SourceDetails>
          ) : null}
        </>
      )}
    </section>
  );
}

/** 模态详情隔离低频操作，支持 Escape、关闭按钮及背景点击退出。 */
function SourceDetails({
  children,
  onClose,
}: Readonly<{ children: React.ReactNode; onClose: () => void }>): ReactElement {
  const reference = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    reference.current?.showModal();
  }, []);
  // 先解除模态焦点限制，再让父级恢复触发按钮焦点并卸载详情。
  const close = (): void => {
    reference.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={reference}
      className={styles.sourceDialog}
      aria-label="官网来源详情"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <button
        className={classNames('button-close', styles.dialogClose)}
        type="button"
        aria-label="关闭详情"
        onClick={close}
      >
        <Icon name="close" />
      </button>
      {children}
    </dialog>
  );
}

/** 单次展示一个物理来源；渠道切换由父级 key 重置，刷新后防止索引越界。 */
function SourceSwitcher({
  sources,
  channel,
  syncReady,
  channelInfo,
}: Readonly<{
  sources: readonly WebSource[];
  channel: RecruitmentChannel;
  syncReady: boolean;
  channelInfo?: WebSourceChannel;
}>): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const index = Math.max(
    0,
    sources.findIndex((source) => source.id === selectedId),
  );
  const source = sources[index];
  if (!source) return null;
  const previous = sources[index - 1];
  const next = sources[index + 1];
  return (
    <div
      className={classNames(styles.sourceSwitcher, sources.length > 1 && styles.multipleSources)}
    >
      {previous ? (
        <button
          type="button"
          className={classNames(styles.sourceArrow, styles.previousSource)}
          aria-label="上一个物理来源"
          onClick={() => {
            setSelectedId(previous.id);
          }}
        >
          <svg
            width="14"
            height="32"
            viewBox="0 0 14 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3 3 16 10 29" />
          </svg>
        </button>
      ) : null}
      <SourcePanel
        key={source.id}
        source={source}
        channel={channel}
        syncReady={syncReady}
        {...(channelInfo ? { channelInfo } : {})}
      />
      {sources.length > 1 ? (
        <span className="sr-only" role="status">
          物理来源 {index + 1} / {sources.length}
        </span>
      ) : null}
      {next ? (
        <button
          type="button"
          className={classNames(styles.sourceArrow, styles.nextSource)}
          aria-label="下一个物理来源"
          onClick={() => {
            setSelectedId(next.id);
          }}
        >
          <svg
            width="14"
            height="32"
            viewBox="0 0 14 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m4 3 7 13-7 13" />
          </svg>
        </button>
      ) : null}
    </div>
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
  const companyHealth = aggregateHealth(sources);
  const activeChannelHealth = aggregateHealth(
    channels.find((channel) => channel.channel === activeSyncChannel)?.sources ?? [],
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
        </div>
        <div
          className={classNames(
            styles['company-sync-channel'],
            styles[`health-${activeChannelHealth}`],
          )}
          data-company-channel-health={activeChannelHealth}
          data-company-active-channel={activeSyncChannel}
        >
          <span className="sr-only">当前同步招聘渠道状态：</span>
          <strong>{healthLabels[activeChannelHealth]}</strong>
        </div>
        <div className={styles['company-source-controls']} data-company-source-controls>
          <label className={styles['company-channel-selector']} data-company-channel-selector>
            <SelectField
              name={`source-channel-${channels[0]?.id ?? companyName}`}
              label={`${companyName}招聘渠道`}
              value={selected}
              onValueChange={(value) => {
                // 1、只接受当前卡片提供的渠道，切换时继续复用统计与同步操作。
                if (value === 'all' || channels.some((channel) => channel.channel === value)) {
                  setSelected(value as SelectedChannel);
                }
              }}
              options={[
                { value: 'all', label: '全部' },
                ...channels.map((channel) => ({
                  value: channel.channel,
                  label: channelLabels[channel.channel],
                })),
              ]}
            />
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
          <SourceSwitcher
            key={selected}
            sources={visibleSources}
            {...(selectedChannel ? { channelInfo: selectedChannel } : {})}
            channel={selectedChannel?.channel ?? 'campus'}
            syncReady={syncReady}
          />
        )}
      </div>
    </article>
  );
}
