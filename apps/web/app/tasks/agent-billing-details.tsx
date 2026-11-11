import type { WebAgentRunSummary } from '@jobhunter/recruitment/contracts/web';
import type { ReactElement } from 'react';
import styles from '../components/lists/data-table.module.css';
import { TruncatedText } from '../components/lists/truncated-text.js';

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
  /** 区分未收到用量与有用量但缺价；已知金额保留六位小数。 */
  const money = (call: NonNullable<WebAgentRunSummary['billingCalls']>[number]): string => {
    if (call.totalCostMicros !== null)
      return `${currencySymbols[call.currency]}${(call.totalCostMicros / 1_000_000).toFixed(6)}`;
    const hasUsage = [
      call.inputTokens,
      call.outputTokens,
      call.uncachedInputTokens,
      call.cacheReadTokens,
      call.cacheWriteTokens,
    ].some((tokens) => tokens != null);
    return hasUsage ? '未定价' : '—';
  };
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
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => {
              const requestedAt = new Date(call.requestedAt);
              const transportReasons = {
                network: '网络连接失败。',
                timeout: '请求超时。',
                cancelled: '请求已取消或中断。',
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
              return (
                <tr key={index}>
                  {/* 单元格只展示时分秒，完整日期时间悬停可见。 */}
                  <td>
                    <TruncatedText
                      value={requestedAt.toLocaleTimeString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour12: false,
                      })}
                      tooltip={requestedAt.toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour12: false,
                      })}
                    />
                  </td>
                  <td className={styles.model}>{call.model}</td>
                  <td>{call.inputTokens ?? '—'}</td>
                  <td>{call.outputTokens ?? '—'}</td>
                  <td>{money(call)}</td>
                  <td className={styles.requestError}>
                    {reason ? <TruncatedText value={reason} /> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
