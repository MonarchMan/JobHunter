import { notFound } from 'next/navigation.js';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import {
  agentRunStatusLabels,
  labelStatus,
  taskStatusLabels,
} from '../../components/status-labels.js';
import { PageHeader } from '../../components/page-header.js';
import { TruncatedText } from '../../components/truncated-text.js';
import { getWebContainer } from '../../../src/server/container.js';
import dataTableStyles from '../../components/data-table.module.css';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agent 运行详情' };

export default async function AgentRunPage({
  params,
}: Readonly<{ params: Promise<{ readonly id: string }> }>): Promise<ReactElement> {
  const { id } = await params;
  const container = await getWebContainer();
  const run = container.services.diagnostics.getAgentRun(id);
  if (!run) notFound();
  return (
    <main id="main-content" tabIndex={-1}>
      <PageHeader eyebrow="AGENT TRACE" title={run.agentKey}>
        <a href="/tasks">返回任务</a>
      </PageHeader>
      <section className="panel">
        <dl className={['facts', styles.facts].filter(Boolean).join(' ')}>
          <div>
            <dt>状态</dt>
            <dd>
              <span className={`status status-${run.status}`}>
                {labelStatus(agentRunStatusLabels, run.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Agent 版本</dt>
            <dd>{run.agentVersion}</dd>
          </div>
          <div>
            <dt>Prompt 版本</dt>
            <dd>{run.promptVersion}</dd>
          </div>
          <div>
            <dt>模型配置指纹</dt>
            <dd>
              <code>{run.modelConfigHash}</code>
            </dd>
          </div>
          <div>
            <dt>输入 / 输出 Token</dt>
            <dd>
              {run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}
            </dd>
          </div>
          <div>
            <dt>价格版本</dt>
            <dd>{run.pricingVersion ?? '—'}</dd>
          </div>
        </dl>
        {run.errorSummary ? (
          <p className="risk">
            {run.errorCategory}: {run.errorSummary}
          </p>
        ) : null}
      </section>
      <section
        className={['panel', dataTableStyles.panel].filter(Boolean).join(' ')}
        aria-labelledby="tools-heading"
      >
        <h2 id="tools-heading">脱敏工具调用</h2>
        <div className={dataTableStyles.scroll}>
          <table>
            <caption className="sr-only">脱敏工具调用列表</caption>
            <thead>
              <tr>
                <th scope="col">序号</th>
                <th scope="col">工具</th>
                <th scope="col">状态</th>
                <th scope="col">耗时</th>
                <th scope="col">错误</th>
              </tr>
            </thead>
            <tbody>
              {run.toolCalls.map((call) => (
                <tr key={call.sequenceNumber}>
                  <td>{call.sequenceNumber}</td>
                  <td>
                    <TruncatedText value={call.toolKey} />
                  </td>
                  <td>
                    <span className={`status status-${call.status}`}>
                      {labelStatus(taskStatusLabels, call.status)}
                    </span>
                  </td>
                  <td>{call.durationMs === null ? '—' : `${String(call.durationMs)} ms`}</td>
                  <td>
                    <TruncatedText value={call.errorSummary ?? '—'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
