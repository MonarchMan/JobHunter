'use client';
import { useState, type ReactElement } from 'react';
import type { UsageReport } from '@jobhunter/common/usage';
import styles from './usage.module.css';

/** 时间桶柱形图；按钮支持键盘聚焦和触屏读取精确值。 */
export function UsageChart({
  report,
  chartStyle = 'bar',
}: {
  report: Pick<UsageReport, 'buckets' | 'filters'>;
  chartStyle?: 'bar' | 'line';
}): ReactElement {
  const [metric, setMetric] = useState<'tokens' | 'requests' | 'cost'>('tokens');
  const [active, setActive] = useState<number | null>(null);
  const labels = { tokens: 'Tokens', requests: '请求', cost: '成本' };
  const peak = Math.max(1, ...report.buckets.map((bucket) => bucket.total[metric]));
  const step = Math.pow(10, Math.floor(Math.log10(peak)));
  const maximum = Math.ceil(peak / step) * step;
  const format = (value: number): string =>
    metric === 'cost'
      ? `${report.filters.currency === 'USD' ? '$' : '¥'}${(value / 1000000).toFixed(4)}`
      : value.toLocaleString('zh-CN');
  const axisValue = (value: number): string =>
    metric === 'cost'
      ? format(value)
      : Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const date = (at: number): string =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      ...(['today', '24h'].includes(report.filters.range)
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : {}),
    }).format(at);
  const selected = active === null ? null : report.buckets[active];
  return (
    <section className={styles.chart} aria-label="使用趋势">
      <div className={styles.heading}>
        <h2>
          使用趋势 ·{' '}
          {
            {
              today: '当天',
              '24h': '近 24 小时',
              '7d': '近 7 天',
              '14d': '近 14 天',
              '30d': '近 30 天',
              all: '全部',
            }[report.filters.range]
          }
        </h2>
        <span className={styles.legend}>
          <i />
          {labels[metric]}
        </span>
        <div className={styles.segment} aria-label="趋势指标">
          {(['tokens', 'requests', 'cost'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => {
                setMetric(key);
              }}
            >
              {labels[key]}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.chartBody}>
        <div className={styles.yAxis}>
          <span>{axisValue(maximum)}</span>
          <span>{axisValue(maximum / 2)}</span>
          <span>0</span>
        </div>
        <div
          className={styles.plot}
          onMouseLeave={() => {
            setActive(null);
          }}
        >
          {chartStyle === 'line' ? (
            <svg
              className={styles.lineChart}
              viewBox="0 0 1000 180"
              preserveAspectRatio="none"
              aria-label="折线图"
            >
              <polyline
                fill="none"
                stroke="#0891b2"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                points={report.buckets
                  .map(
                    (bucket, index) =>
                      `${String(((index + 0.5) / report.buckets.length) * 1000)},${String(180 - (bucket.total[metric] / maximum) * 180)}`,
                  )
                  .join(' ')}
              />
            </svg>
          ) : null}
          {selected ? (
            <div
              className={styles.tooltip}
              aria-live="polite"
              style={{
                left: `${String(Math.min(75, Math.max(2, ((active ?? 0) / report.buckets.length) * 100)))}%`,
              }}
            >
              <strong>{date(selected.at)}</strong>
              <div>
                <span className={styles.legend}>
                  <i />
                  {labels[metric]}
                </span>
                <span>{format(selected.total[metric])}</span>
              </div>
            </div>
          ) : null}
          {report.buckets.map((bucket, index) => (
            <button
              type="button"
              key={bucket.at}
              className={styles.barSlot}
              onMouseEnter={() => {
                setActive(index);
              }}
              onFocus={() => {
                setActive(index);
              }}
              onClick={() => {
                setActive(index);
              }}
              aria-label={`${date(bucket.at)} ${labels[metric]} ${format(bucket.total[metric])}`}
            >
              <span
                className={chartStyle === 'line' ? styles.linePoint : styles.bar}
                style={{
                  ...(chartStyle === 'line'
                    ? { bottom: `${String((bucket.total[metric] / maximum) * 100)}%` }
                    : {}),
                  height: `${String(Math.max(bucket.total[metric] > 0 ? 1 : 0, (bucket.total[metric] / maximum) * 100))}%`,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className={styles.axis}>
        {report.buckets
          .filter(
            (_, index) =>
              index % Math.max(1, Math.ceil(report.buckets.length / 7)) === 0 ||
              index === report.buckets.length - 1,
          )
          .map((bucket) => (
            <span key={bucket.at}>{date(bucket.at)}</span>
          ))}
      </div>
    </section>
  );
}
