import type { WebAgentRunSummary } from '@jobhunter/recruitment/contracts/web';
import type { ReactElement } from 'react';
import styles from '../components/lists/data-table.module.css';

const currencySymbols = { USD: '$', CNY: '¥' } as const;

/** 展示逐请求的用量与费用明细；每个单元格只展示一个值。 */
export function AgentBillingDetails({
  calls,
}: Readonly<{ calls: WebAgentRunSummary['billingCalls'] }>): ReactElement {
  if (!calls?.length) return <p className="muted">此记录没有用量明细。</p>;
  /** 微单位金额保留六位小数，币种以符号展示；无法定价按 AGT-015 明示。 */
  const money = (value: number | null, currency: 'USD' | 'CNY'): string =>
    value === null ? '未定价' : `${currencySymbols[currency]}${(value / 1_000_000).toFixed(6)}`;
  return (
    <section aria-label="请求用量与费用">
      <h3>请求用量与费用</h3>
      <div className={styles.scroll}>
        <table className={styles.compact}>
          <thead>
            <tr>
              <th>时间</th>
              <th>模型</th>
              <th>输入</th>
              <th>输出</th>
              <th>成本</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => {
              const requestedAt = new Date(call.requestedAt);
              return (
                <tr key={index}>
                  {/* 单元格只展示时分秒，完整日期时间悬停可见。 */}
                  <td
                    title={requestedAt.toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      hour12: false,
                    })}
                  >
                    {requestedAt.toLocaleTimeString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      hour12: false,
                    })}
                  </td>
                  <td className={styles.model}>{call.model}</td>
                  <td>{call.inputTokens ?? '—'}</td>
                  <td>{call.outputTokens ?? '—'}</td>
                  <td>{money(call.totalCostMicros, call.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
