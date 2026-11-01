import type { WebAgentRunSummary } from '@jobhunter/recruitment/contracts/web';
import type { ReactElement } from 'react';
import styles from '../components/lists/data-table.module.css';

/** 展示逐请求的缓存及费用明细；任一请求未上报的统计不合成为伪精确总数。 */
export function AgentBillingDetails({
  calls,
}: Readonly<{ calls: WebAgentRunSummary['billingCalls'] }>): ReactElement {
  if (!calls?.length) return <p className="muted">此记录没有缓存用量明细。</p>;
  /** 只在所有请求都上报时提供累计缓存量。 */
  const total = (
    key: 'cacheReadTokens' | 'cacheWriteTokens' | 'uncachedInputTokens',
  ): number | null => {
    return calls.some((call) => call[key] === null)
      ? null
      : calls.reduce((sum, call) => sum + (call[key] ?? 0), 0);
  };
  /** 微单位金额保留六位小数，显示原始计价币种。 */
  const money = (value: number | null, currency: string): string =>
    value === null ? '未定价' : `${currency} ${(value / 1_000_000).toFixed(6)}`;
  return (
    <section aria-label="缓存用量与分项费用">
      <h3>缓存用量与分项费用</h3>
      <p>
        缓存命中 {total('cacheReadTokens') ?? '—'} · 未命中 {total('uncachedInputTokens') ?? '—'} ·
        缓存写入 {total('cacheWriteTokens') ?? '—'}
      </p>
      <div className={styles.scroll}>
        <table>
          <thead>
            <tr>
              <th>请求 / 时段</th>
              <th>输入未命中</th>
              <th>缓存命中</th>
              <th>缓存写入</th>
              <th>输出</th>
              <th>估算合计</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => (
              <tr key={index}>
                <td>
                  {index + 1} ·{' '}
                  {call.period === 'peak'
                    ? '忙时'
                    : call.period === 'off-peak'
                      ? '闲时'
                      : call.period === 'fixed'
                        ? '固定价'
                        : '时段未知'}
                  <small>
                    {new Date(call.requestedAt).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                  </small>
                  <small>{call.model}</small>
                </td>
                <td>
                  {call.uncachedInputTokens ?? '—'}
                  <small>{money(call.inputCostMicros, call.currency)}</small>
                </td>
                <td>
                  {call.cacheReadTokens ?? '—'}
                  <small>{money(call.cacheReadCostMicros, call.currency)}</small>
                </td>
                <td>
                  {call.cacheWriteTokens ?? '—'}
                  <small>{money(call.cacheWriteCostMicros, call.currency)}</small>
                  {(call.cacheWrite5mTokens != null || call.cacheWrite1hTokens != null) && (
                    <>
                      <small>
                        5 分钟：{call.cacheWrite5mTokens ?? '—'} ·{' '}
                        {money(call.cacheWrite5mCostMicros ?? null, call.currency)}
                      </small>
                      <small>
                        1 小时：{call.cacheWrite1hTokens ?? '—'} ·{' '}
                        {money(call.cacheWrite1hCostMicros ?? null, call.currency)}
                      </small>
                    </>
                  )}
                </td>
                <td>
                  {call.outputTokens ?? '—'}
                  <small>{money(call.outputCostMicros, call.currency)}</small>
                </td>
                <td>
                  {money(call.totalCostMicros, call.currency)}
                  <small>
                    {call.precision === 'reported'
                      ? '按上报用量计算'
                      : call.precision === 'unpriced'
                        ? '缺少价格或用量'
                        : '缓存明细不全，含估算'}
                  </small>
                  <small>{call.pricingVersion}</small>
                  {call.pricingVersion.startsWith('cc-switch-8be8405-usd-reference') && (
                    <small>旧型号美元参考价（cc-switch）</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
