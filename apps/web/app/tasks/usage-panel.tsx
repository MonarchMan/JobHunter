'use client';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation.js';
import {
  convertUsageCost,
  type UsageCall,
  type UsageReport,
  type UsageTotals,
} from '@jobhunter/common/usage';
import { SelectField } from '../components/forms/select-field.js';
import { TaskAutoRefresh } from './task-auto-refresh.js';
import { UsageChart } from './usage-chart.js';
import styles from './usage.module.css';

/** 未知量保持破折号，禁止将未知展示为零。 */
function number(value: number | null | undefined): string {
  return value == null ? '—' : value.toLocaleString('zh-CN');
}
/** 大计数使用紧凑格式，小计数保留千位分隔。 */
function compact(value: number | null | undefined): string {
  return value == null
    ? '—'
    : value < 10000
      ? number(value)
      : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
/** 缓存命中率按已上报输入加权，零分母不报告比率。 */
function rate(total: UsageTotals): string {
  return total.cacheInput ? `${((total.cacheRead / total.cacheInput) * 100).toFixed(1)}%` : '—';
}
/** 真实测量不加估算符号；缺失时延不能以总耗时替代。 */
function seconds(value: number | null | undefined): string {
  return value == null ? '—' : `${(value / 1000).toFixed(1)}s`;
}
/** 输出至少 100 token 才展示速度，避免极短响应的测量误差。 */
function speed(value: number | null | undefined): ReactNode {
  return value == null ? (
    '—'
  ) : (
    <>
      {value.toFixed(0)}
      <small> tok/s</small>
    </>
  );
}
const columns = [
  ['application', '应用'],
  ['provider', '供应商'],
  ['model', '模型'],
  ['input', '新增输入'],
  ['output', '输出'],
  ['cacheRead', '缓存命中'],
  ['cacheWrite', '缓存写入'],
  ['cacheRate', '命中率'],
  ['cost', '成本'],
  ['speed', '速度'],
  ['first', '首字'],
  ['duration', '总耗时'],
  ['status', '状态码'],
] as const;
const defaultColumns = [
  'application',
  'provider',
  'model',
  'input',
  'output',
  'cacheRead',
  'cost',
  'speed',
  'first',
];
const ranges = [
  { value: 'today', label: '当天' },
  { value: '24h', label: '近 24 小时' },
  { value: '7d', label: '近 7 天' },
  { value: '14d', label: '近 14 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'all', label: '全部' },
];

/** 统计主视图：公共下拉框更新 URL，所有聚合与分页使用同一筛选集。 */
export function UsagePanel({ report, view }: { report: UsageReport; view: string }): ReactElement {
  const router = useRouter();
  const search = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const { filters, total } = report;
  const currentView = ['logs', 'providers', 'models', 'settings'].includes(view) ? view : 'logs';
  const visible = (search.get('columns') ?? defaultColumns.join(',')).split(',');
  const chartStyle = search.get('chart') === 'line' ? 'line' : 'bar';
  const money = (value: number, currency: 'USD' | 'CNY', digits = 4): string =>
    `${filters.currency === 'USD' ? '$' : '¥'}${(convertUsageCost(value, currency, filters.currency, report.usdToCnyRate) / 1000000).toFixed(digits)}`;
  /** 汇总已统一换算，未知费用不作为零参与合计。 */
  const costs = (value: UsageTotals): string =>
    value.cost === null ? '—' : money(value.cost, filters.currency, 2);
  const href = (changes: Record<string, string>): string =>
    `/tasks?${new URLSearchParams({
      tab: 'usage',
      range: filters.range,
      model: filters.model,
      provider: filters.provider,
      currency: filters.currency,
      statusCode: filters.statusCode,
      usagePage: String(filters.page),
      view: currentView,
      chart: chartStyle,
      columns: visible.join(','),
      ...changes,
    })}`;
  const select = (key: string, value: string): void => {
    router.push(
      href({
        [key]: value,
        usagePage: '1',
        ...(key === 'provider' ? { model: '' } : {}),
      }),
      { scroll: false },
    );
  };
  const groups =
    currentView === 'providers'
      ? report.providerGroups.map((group) => ({ name: group.provider, total: group.total }))
      : report.groups.map((group) => ({ name: group.model, total: group.total }));
  const count = currentView === 'logs' ? total.requests : groups.length;
  const pages = Math.max(1, Math.ceil(count / 20));
  const page = Math.min(filters.page, pages);
  const success = (value: UsageTotals): string =>
    value.knownStatus ? `${((value.successful / value.knownStatus) * 100).toFixed(1)}%` : '—';
  /** 列选择只控制展示，原始计量与账单快照保持不变。 */
  const cell = (key: string, call: UsageCall): ReactNode => {
    switch (key) {
      case 'application':
        return <span title={call.agent}>{call.application ?? 'JobHunter'}</span>;
      case 'provider':
        return call.provider ?? '—';
      case 'model':
        return <span className={styles.model}>{call.model}</span>;
      case 'input':
        return compact(call.uncachedInputTokens);
      case 'output':
        return compact(call.outputTokens);
      case 'cacheRead':
        return (
          <span
            title={`缓存命中 ${number(call.cacheReadTokens)} · 缓存写入 ${number(call.cacheWriteTokens)}`}
          >
            {compact(call.cacheReadTokens)}
          </span>
        );
      case 'cacheWrite':
        return compact(call.cacheWriteTokens);
      case 'cacheRate':
        return call.inputTokens && call.cacheReadTokens != null
          ? `${((100 * call.cacheReadTokens) / call.inputTokens).toFixed(1)}%`
          : '—';
      case 'cost':
        return call.totalCostMicros == null ? (
          <span title="未定价">—</span>
        ) : (
          money(call.totalCostMicros, call.currency)
        );
      case 'speed':
        return speed(
          (call.outputTokens ?? 0) >= 100 && !call.transportError
            ? call.outputTokensPerSecond
            : null,
        );
      case 'first':
        return seconds(call.firstTokenMs);
      case 'duration':
        return seconds(call.durationMs);
      case 'status':
        return <span title={call.transportError ?? undefined}>{call.statusCode ?? '—'}</span>;
      default:
        return '—';
    }
  };
  return (
    <div className={styles.dashboard}>
      <div className={styles.filters}>
        <div className={styles.filterFields}>
          <SelectField
            name="currency"
            label="币种"
            value={filters.currency}
            onValueChange={(value) => {
              select('currency', value);
            }}
            options={[
              { value: 'USD', label: 'USD · 美元' },
              { value: 'CNY', label: 'CNY · 人民币' },
            ]}
          />
          <SelectField
            name="provider"
            label="供应商"
            value={filters.provider}
            onValueChange={(value) => {
              select('provider', value);
            }}
            options={[
              { value: '', label: '供应商' },
              ...report.providers.map((provider) => ({ value: provider, label: provider })),
            ]}
          />
          <SelectField
            name="model"
            label="模型"
            value={filters.model}
            onValueChange={(value) => {
              select('model', value);
            }}
            options={[
              { value: '', label: '模型' },
              ...report.models.map((model) => ({ value: model, label: model })),
            ]}
          />
          <SelectField
            name="range"
            label="时间范围"
            value={filters.range}
            onValueChange={(value) => {
              select('range', value);
            }}
            options={ranges}
          />
        </div>
        <TaskAutoRefresh />
      </div>
      <div className={styles.metricRow}>
        <div className={styles.metrics}>
          <article title="按请求价格快照估算，仅合计已知金额">
            <span
              title={
                '显示币种 ' + filters.currency + '；1 USD = ' + String(report.usdToCnyRate) + ' CNY'
              }
            >
              总成本
            </span>
            <strong>
              {total.requests && total.unpriced === total.requests ? '—' : costs(total)}
            </strong>
          </article>
          <article
            title={
              report.legacyRuns
                ? `${String(report.legacyRuns)} 次历史运行缺少逐请求明细`
                : undefined
            }
          >
            <span>总请求数</span>
            <strong>{number(total.requests)}</strong>
          </article>
          <article
            title={`新增输入 + 输出 + 缓存写入 + 缓存命中；输入已包含缓存，不重复累计${total.unknownTokens ? `，${String(total.unknownTokens)} 次请求用量不完整` : ''}`}
          >
            <span>
              真实消耗 Tokens <span className={styles.info}>?</span>
            </span>
            <strong>
              {compact(
                total.requests && total.unknownTokens === total.requests && !total.tokens
                  ? null
                  : total.tokens,
              )}
            </strong>
          </article>
          <article title="缓存命中 ÷（新增输入 + 缓存写入 + 缓存命中）">
            <span>
              缓存命中率 <span className={styles.info}>?</span>
            </span>
            <strong>{rate(total)}</strong>
          </article>
        </div>
        <button
          type="button"
          className={styles.more}
          aria-expanded={expanded}
          aria-controls="usage-extra-metrics"
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          更多指标 <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        {expanded ? (
          <div id="usage-extra-metrics" className={[styles.metrics, styles.extraMetrics].join(' ')}>
            <article>
              <span>新增输入</span>
              <strong>
                {compact(
                  total.requests && total.unknownUncached === total.requests
                    ? null
                    : total.uncached,
                )}
              </strong>
            </article>
            <article>
              <span>Output</span>
              <strong>
                {compact(
                  total.requests && total.unknownOutput === total.requests ? null : total.output,
                )}
              </strong>
            </article>
            <article title="供应商未上报缓存写入时不推测为零">
              <span>
                创建 <span className={styles.info}>?</span>
              </span>
              <strong>
                {total.requests && total.unknownCacheWrite === total.requests
                  ? 'N/A'
                  : compact(total.cacheWrite)}
              </strong>
            </article>
            <article>
              <span>命中</span>
              <strong>
                {compact(
                  total.requests && total.unknownCache === total.requests ? null : total.cacheRead,
                )}
              </strong>
            </article>
          </div>
        ) : null}
      </div>
      <UsageChart report={{ buckets: report.buckets, filters }} chartStyle={chartStyle} />
      <section className={styles.logs} aria-label="用量明细">
        <div className={styles.logHeading}>
          <nav className={styles.tabs} aria-label="统计明细">
            {(
              [
                ['logs', '请求日志'],
                ['providers', '供应商'],
                ['models', '模型'],
                ['settings', '设置'],
              ] as const
            ).map(([key, label]) => (
              <a
                key={key}
                href={href({ view: key, usagePage: '1' })}
                aria-current={currentView === key ? 'page' : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          {currentView === 'logs' ? (
            <div className={styles.statusSelect}>
              <SelectField
                name="statusCode"
                label="状态码"
                value={filters.statusCode}
                onValueChange={(value) => {
                  select('statusCode', value);
                }}
                options={[
                  { value: '', label: '全部状态码' },
                  ...report.statusCodes.map((code) => ({
                    value: String(code),
                    label: String(code),
                  })),
                  { value: 'unknown', label: '无状态码' },
                ]}
              />
            </div>
          ) : currentView !== 'settings' ? (
            <span className={styles.sortLabel}>按请求数排序</span>
          ) : null}
        </div>
        {currentView === 'settings' ? (
          <>
            <h3 className={styles.settingsHeading}>显示</h3>
            <div className={styles.settings}>
              <label>
                趋势图样式
                <SelectField
                  name="chart"
                  label="趋势图样式"
                  value={chartStyle}
                  onValueChange={(value) => {
                    select('chart', value);
                  }}
                  options={[
                    { value: 'bar', label: '柱形图' },
                    { value: 'line', label: '折线图' },
                  ]}
                />
              </label>
              <label>
                请求日志的列
                <SelectField
                  name="columns"
                  label="请求日志的列"
                  value=""
                  onValueChange={(value) => {
                    if (!value) return;
                    if (value === 'default') {
                      select('columns', defaultColumns.join(','));
                      return;
                    }
                    const [key, action] = value.split(':');
                    if (key)
                      select(
                        'columns',
                        action === 'show'
                          ? [...new Set([...visible, key])].join(',')
                          : visible.filter((item) => item !== key).join(','),
                      );
                  }}
                  options={[
                    {
                      value: '',
                      label: `${String(columns.filter(([key]) => visible.includes(key)).length)} / 13 列`,
                    },
                    ...columns.map(([key, label]) => ({
                      value: key,
                      label: `${visible.includes(key) ? '✓ ' : ''}${label}`,
                      children: [
                        { value: `${key}:show`, label: '显示' },
                        { value: `${key}:hide`, label: '隐藏' },
                      ],
                    })),
                    { value: 'default', label: '恢复默认列' },
                  ]}
                />
              </label>
            </div>
            <div className={styles.pricingHeading}>
              <h3>定价</h3>
              <span title="请求价格快照按显示币种及配置汇率换算，不修改原始报价">
                {filters.currency} / 每百万 Tokens
              </span>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <caption className="sr-only">模型定价</caption>
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>缓存命中</th>
                    <th>缓存写入</th>
                    <th>版本</th>
                  </tr>
                </thead>
                <tbody>
                  {report.prices.length ? (
                    report.prices.map((price, index) => (
                      <tr key={index}>
                        <td>{price.model}</td>
                        {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
                          <td key={key}>
                            {price.rates?.[key] == null
                              ? '—'
                              : money(price.rates[key], price.currency, 2)}
                          </td>
                        ))}
                        <td>
                          {price.pricingVersion} · {price.period}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className={styles.empty}>
                        暂无定价记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : total.requests === 0 ? (
          <div className={styles.empty}>
            <h3>暂无用量记录</h3>
          </div>
        ) : (
          <div className={styles.tableScroll}>
            <table>
              <caption className="sr-only">
                {currentView === 'logs'
                  ? '请求日志'
                  : currentView === 'models'
                    ? '模型用量汇总'
                    : '供应商用量汇总'}
              </caption>
              <thead>
                {currentView === 'logs' ? (
                  <tr>
                    <th>时间</th>
                    {columns
                      .filter(([key]) => visible.includes(key))
                      .map(([key, label]) => (
                        <th
                          key={key}
                          title={
                            key === 'speed'
                              ? '输出不少于 100 Tokens 时：输出 / 首个有效内容到响应结束的秒数'
                              : key === 'first'
                                ? '从请求开始到首个有效流式内容'
                                : undefined
                          }
                        >
                          {label}
                          {key === 'speed' || key === 'first' ? (
                            <>
                              {' '}
                              <span className={styles.info}>?</span>
                            </>
                          ) : null}
                        </th>
                      ))}
                  </tr>
                ) : (
                  <tr>
                    <th>{currentView === 'models' ? '模型' : '供应商'}</th>
                    <th>请求数</th>
                    <th>Tokens</th>
                    <th>成本</th>
                    <th>成功率</th>
                    <th title="有效输出总数 / 生成时间总和，仅成功流式且输出至少 100 Tokens">
                      速度 <span className={styles.info}>?</span>
                    </th>
                    <th title="成功流式请求首字时间的中位数">
                      首字 <span className={styles.info}>?</span>
                    </th>
                  </tr>
                )}
              </thead>
              <tbody>
                {currentView === 'logs'
                  ? report.calls.map((call) => (
                      <tr
                        key={call.id}
                        title={`${call.statusCode == null ? '无状态码' : `HTTP ${String(call.statusCode)}`}${call.transportError ? ` · ${call.transportError}` : ''}`}
                      >
                        <td
                          title={new Date(call.requestedAt).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                          })}
                        >
                          {new Date(call.requestedAt).toLocaleTimeString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                            hour12: false,
                          })}
                        </td>
                        {columns
                          .filter(([key]) => visible.includes(key))
                          .map(([key]) => (
                            <td key={key}>{cell(key, call)}</td>
                          ))}
                      </tr>
                    ))
                  : groups.slice((page - 1) * 20, page * 20).map((group) => (
                      <tr key={group.name}>
                        <td>{group.name}</td>
                        <td>{number(group.total.requests)}</td>
                        <td title={group.total.unknownTokens ? '部分请求用量未上报' : undefined}>
                          {compact(group.total.tokens)}
                        </td>
                        <td>
                          {group.total.unpriced === group.total.requests ? '—' : costs(group.total)}
                        </td>
                        <td>{success(group.total)}</td>
                        <td>{speed(group.total.outputTokensPerSecond)}</td>
                        <td>{seconds(group.total.firstTokenMs)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {currentView !== 'settings' ? (
          <nav className={styles.pagination} aria-label="用量日志分页">
            <span className={styles.recordCount}>共 {count} 条记录</span>
            {page > 1 ? (
              <a aria-label="上一页" href={href({ usagePage: String(page - 1) })}>
                ‹
              </a>
            ) : (
              <span aria-label="上一页">‹</span>
            )}
            <span>
              {page} / {pages}
            </span>
            {page < pages ? (
              <a aria-label="下一页" href={href({ usagePage: String(page + 1) })}>
                ›
              </a>
            ) : (
              <span aria-label="下一页">›</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
