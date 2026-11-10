import type { WebAgentRunSummary } from '@jobhunter/recruitment/contracts/web';
import type { ReactElement } from 'react';
import styles from '../components/lists/data-table.module.css';

const currencySymbols = { USD: '$', CNY: '¥' } as const;

/** 展示逐请求的用量与费用明细；每个单元格只展示一个值。 */
export function AgentBillingDetails({
  calls,
  hasReportedUsage,
  lastOutputFailure,
  normallySingleRequest = false,
}: Readonly<{
  calls: WebAgentRunSummary['billingCalls'];
  hasReportedUsage: boolean;
  lastOutputFailure?: string | null;
  normallySingleRequest?: boolean;
}>): ReactElement {
  if (!calls?.length)
    return (
      <p className="muted">
        {hasReportedUsage
          ? '此记录仅有汇总用量，缺少逐请求明细，无法还原真实请求次数。'
          : '此记录尚无模型请求明细。'}
      </p>
    );
  /** 微单位金额保留六位小数，币种以符号展示；无法定价按 AGT-015 明示。 */
  const money = (value: number | null, currency: 'USD' | 'CNY'): string =>
    value === null ? '未定价' : `${currencySymbols[currency]}${(value / 1_000_000).toFixed(6)}`;
  return (
    <section aria-label="请求用量与费用">
      <h3>请求用量与费用</h3>
      <p className="muted">
        共 {calls.length} 次实际模型请求。一次 Agent 运行可能包含格式协商、输出纠正或失败重试。
      </p>
      {calls.length > 1 ? (
        <ul aria-label="请求失败与纠正原因" className="muted">
          {calls.map((call, index) => {
            const transportReasons = {
              network: '网络连接失败。',
              timeout: '请求超时。',
              cancelled: '请求已取消。',
              invalid_output: '响应格式无效。',
            };
            const reason =
              call.failureReason ??
              (call.transportError ? transportReasons[call.transportError] : null) ??
              (call.statusCode && call.statusCode >= 400
                ? `模型服务返回 HTTP ${String(call.statusCode)}。`
                : null) ??
              (index === calls.length - 1 && lastOutputFailure ? lastOutputFailure : null) ??
              (normallySingleRequest && index < calls.length - 1
                ? '历史请求未记录该次失败或纠正的具体原因。'
                : null);
            return reason ? (
              <li key={call.requestId ?? index}>
                第 {index + 1} 次请求：{reason}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
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
