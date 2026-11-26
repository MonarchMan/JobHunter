import { TaskTabs } from './task-tabs.js';
import { UsagePanel } from './usage-panel.js';
import { SearchButton } from '../components/forms/search-button.js';
import { NavigationForm } from '../components/forms/navigation-form.js';
import { NavigationLink } from '../components/layout/navigation-pending.js';
import { listPageSize } from '../../src/server/job-query.js';
import type { Metadata } from 'next';
import { Suspense, type ReactElement } from 'react';
import { SectionLoading } from '../components/layout/section-loading.js';
import {
  agentRunStatusLabels,
  labelStatus,
  taskStatusLabels,
  taskTypeLabels,
} from '../components/status-labels.js';
import { TruncatedText } from '../components/lists/truncated-text.js';
import { Pagination } from '../components/lists/pagination.js';
import { getWebContainer } from '../../src/server/container.js';
import { browserTestRenderDelay } from '../../src/server/browser-test-render-delay.js';
import {
  firstSearchParameter,
  pageHref,
  type SearchParameterSource,
} from '../../src/server/job-query.js';
import { TaskActions } from './task-actions.js';
import { taskPresentation } from './task-presentation.js';
import { TaskAutoRefresh } from './task-auto-refresh.js';
import {
  AgentRunDetailsDialog,
  DiagnosticRecord,
  TaskDetailsDialog,
} from './diagnostic-details.js';
import { CurrencySelect } from './currency-select.js';
import { SelectField } from '../components/forms/select-field.js';
import { taskTimeRange } from '../../src/server/task-time-range.js';
import dataTableStyles from '../components/lists/data-table.module.css';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '任务与 Agent 运行' };

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

/** 列表共享格式化器，避免为每个时间单元格重复创建实例。 */
function time(value: string | null): string {
  return value ? timeFormatter.format(new Date(value)) : '—';
}

/** 根据开始和完成时间显示执行耗时；时间缺失时不推算未完成任务的最终耗时。 */
function taskDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—';
  const milliseconds = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  if (milliseconds < 1000) return `${String(milliseconds / 1000)} s`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ${String(seconds % 60)} s`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min ${String(seconds % 60)} s`;
}

function positivePage(source: SearchParameterSource, name: string): number {
  const value = Number(firstSearchParameter(source, name) ?? '1');
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/** 将不同运行记录统一换算成当前页面选择的展示货币。汇率来自显式配置，避免页面隐式猜价。 */
function formatCost(
  micros: number | null,
  sourceCurrency: string | null,
  displayCurrency: 'USD' | 'CNY',
): string {
  if (micros === null) return '—';
  const rate = Number(process.env.MODEL_USD_TO_CNY_RATE ?? '7.2');
  const source = sourceCurrency === 'CNY' ? 'CNY' : 'USD';
  const amount = micros / 1_000_000;
  const converted =
    source === displayCurrency ? amount : displayCurrency === 'CNY' ? amount * rate : amount / rate;
  return `${displayCurrency === 'CNY' ? '¥' : '$'}${converted.toFixed(4)}`;
}

interface TasksPageProperties {
  readonly searchParams: Promise<SearchParameterSource>;
}

/** 页签在任务或用量数据查询之前确定；同一路由切换视图时重置数据边界。 */
export default async function TasksPage({
  searchParams,
}: TasksPageProperties): Promise<ReactElement> {
  const parameters = await searchParams;
  const usage = firstSearchParameter(parameters, 'tab') === 'usage';
  return (
    <main id="main-content" tabIndex={-1}>
      <TaskTabs usage={usage} />
      <Suspense
        key={usage ? 'usage' : 'tasks'}
        fallback={<SectionLoading label={usage ? '正在加载用量统计' : '正在加载任务与 Agent'} />}
      >
        {usage ? (
          <UsageContent parameters={parameters} />
        ) : (
          <TasksContent parameters={parameters} />
        )}
      </Suspense>
    </main>
  );
}

type TaskContentProperties = Readonly<{ parameters: SearchParameterSource }>;

/** 只读取用量视图所需的数据。 */
async function UsageContent({ parameters }: TaskContentProperties): Promise<ReactElement> {
  await browserTestRenderDelay('usage');
  const container = await getWebContainer();
  const report = container.services.usage.query({
    range: firstSearchParameter(parameters, 'range'),
    model: firstSearchParameter(parameters, 'model'),
    status: firstSearchParameter(parameters, 'usageStatus'),
    provider: firstSearchParameter(parameters, 'provider'),
    statusCode: firstSearchParameter(parameters, 'statusCode'),
    currency: firstSearchParameter(parameters, 'currency'),
    page: firstSearchParameter(parameters, 'usagePage'),
  });
  return (
    <UsagePanel
      report={{
        ...report,
        buckets: report.buckets.map(({ at, total: { tokens, requests, cost } }) => ({
          at,
          total: { tokens, requests, cost },
        })),
      }}
      view={firstSearchParameter(parameters, 'view') ?? 'logs'}
    />
  );
}

/** 读取任务与 Agent 列表，明细仍由原有入口按需查询。 */
async function TasksContent({ parameters }: TaskContentProperties): Promise<ReactElement> {
  const status = firstSearchParameter(parameters, 'status');
  const taskType = firstSearchParameter(parameters, 'type');
  const taskPage = positivePage(parameters, 'taskPage');
  const agentPage = positivePage(parameters, 'agentPage');
  const requestedCurrency = firstSearchParameter(parameters, 'currency');
  const displayCurrency: 'USD' | 'CNY' = requestedCurrency === 'CNY' ? 'CNY' : 'USD';
  const currencyHrefs = (['USD', 'CNY'] as const).reduce(
    (result, currency) => {
      const query = new URLSearchParams();
      for (const [key, raw] of Object.entries(parameters)) {
        const value = typeof raw === 'string' || raw === undefined ? raw : raw[0];
        if (value && key !== 'currency') query.set(key, value);
      }
      query.set('currency', currency);
      result[currency] = `/tasks?${query.toString()}`;
      return result;
    },
    {} as Record<'USD' | 'CNY', string>,
  );
  const container = await getWebContainer();
  const { range, ...timeFilter } = taskTimeRange(firstSearchParameter(parameters, 'range'));
  const diagnostics = container.services.diagnostics.list({
    ...timeFilter,
    ...(status === 'warning' ||
    status === 'pending' ||
    status === 'running' ||
    status === 'failed' ||
    status === 'succeeded' ||
    status === 'cancelled'
      ? { status }
      : {}),
    ...(taskType ? { taskType } : {}),
    taskPage,
    agentPage,
    taskPageSize: listPageSize(parameters, 'taskPageSize'),
    agentPageSize: listPageSize(parameters, 'agentPageSize'),
  });
  // 仅已打开的详情使用本轮快照标识重新查询，不随列表传输详情。
  const diagnosticsRevision = Date.now();
  return (
    <>
      <NavigationForm
        key={JSON.stringify([range, status, taskType])}
        className={styles.filters}
        action="/tasks"
        aria-label="任务筛选"
        noValidate
      >
        <label>
          时间
          <SelectField
            name="range"
            label="时间"
            defaultValue={range}
            fitOptions
            options={[
              { value: 'today', label: '当天' },
              { value: '7d', label: '近7天' },
              { value: '30d', label: '近30天' },
              { value: 'all', label: '全部' },
            ]}
          />
        </label>
        <label>
          状态
          <SelectField
            name="status"
            label="状态"
            defaultValue={status ?? ''}
            options={[
              { value: '', label: '全部' },
              { value: 'pending', label: '等待中' },
              { value: 'running', label: taskStatusLabels.running },
              { value: 'failed', label: '失败' },
              { value: 'warning', label: '警告' },
              { value: 'succeeded', label: '已完成' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
        </label>
        <label>
          类型
          <SelectField
            name="type"
            fitOptions
            label="类型"
            defaultValue={taskType ?? ''}
            options={[
              { value: '', label: '全部' },
              ...Object.entries(taskTypeLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </label>
        <SearchButton />
        <NavigationLink className="button-secondary" href="/tasks">
          清除
        </NavigationLink>
        <TaskAutoRefresh />
      </NavigationForm>

      <section
        className={['panel', dataTableStyles.panel].filter(Boolean).join(' ')}
        aria-labelledby="task-heading"
        data-task-section
      >
        <h2 id="task-heading">后台任务</h2>
        <div
          className={[dataTableStyles.scroll, styles.desktopTable].filter(Boolean).join(' ')}
          data-task-table
        >
          <table className={styles.taskTable} role="table" aria-label="后台任务列表">
            <caption className="sr-only">后台任务列表</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  类型
                </th>
                <th role="columnheader" scope="col">
                  状态
                </th>
                <th role="columnheader" scope="col">
                  重试
                </th>
                <th role="columnheader" scope="col">
                  错误
                </th>
                <th role="columnheader" scope="col">
                  耗时
                </th>
                <th role="columnheader" scope="col">
                  操作
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {diagnostics.tasks.length === 0 ? (
                <tr role="row">
                  <td role="cell" className={dataTableStyles.empty} colSpan={6}>
                    <strong>暂无后台任务</strong>
                    <span>来源同步、健康检查或其他操作开始后，任务会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.tasks.map((task) => {
                  const presentation = taskPresentation(task);
                  const duration = taskDuration(task.startedAt, task.finishedAt);
                  const counts = task.jobDetailBatch?.counts;
                  return (
                    <DiagnosticRecord key={task.id}>
                      <td role="cell" className={styles.cardTitle}>
                        <strong>
                          <TaskDetailsDialog
                            id={task.id}
                            kind={task.kind}
                            taskType={task.taskType}
                            revision={diagnosticsRevision}
                          />
                        </strong>
                        {counts ? (
                          <p className={styles.mobileOnly}>
                            总数 {counts.total}，成功 {counts.succeeded}，失败 {counts.failed}
                          </p>
                        ) : null}
                      </td>
                      <td role="cell">
                        <span className={`status status-${presentation.status}`}>
                          {presentation.label}
                        </span>
                      </td>
                      <td role="cell" className={styles.desktopOnly}>
                        {String(task.attemptCount)}
                      </td>
                      <td
                        role="cell"
                        className={presentation.error ? styles.cardError : styles.desktopOnly}
                      >
                        {presentation.error ? <TruncatedText value={presentation.error} /> : '—'}
                      </td>
                      <td
                        role="cell"
                        className={duration === '—' ? styles.desktopOnly : styles.cardTime}
                      >
                        <span className={styles.mobileOnly}>耗时 </span>
                        <TruncatedText
                          value={duration}
                          tooltip={`${time(task.startedAt)} - ${time(task.finishedAt)}`}
                        />
                      </td>
                      <td
                        role="cell"
                        className={task.kind === 'task' ? styles.cardActions : styles.desktopOnly}
                      >
                        {task.kind === 'task' ? (
                          <TaskActions
                            taskId={task.id}
                            status={task.status}
                            taskType={task.taskType}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </DiagnosticRecord>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={diagnostics.taskPagination.total}
          pageSize={diagnostics.taskPagination.pageSize}
          pageParameter="taskPage"
          sizeParameter="taskPageSize"
          currentPage={diagnostics.taskPagination.current}
          totalPages={diagnostics.taskPagination.totalPages}
          label="后台任务分页"
          scrollTargetId="task-heading"
          createHref={(page) => `/tasks${pageHref(parameters, 'taskPage', page)}`}
        />
      </section>

      <section
        className={['panel', dataTableStyles.panel].filter(Boolean).join(' ')}
        aria-labelledby="agent-heading"
        data-agent-section
      >
        <div className={styles.sectionHeading}>
          <h2 id="agent-heading">Agent 运行</h2>
          <CurrencySelect value={displayCurrency} hrefs={currencyHrefs} />
        </div>
        <div
          className={[dataTableStyles.scroll, styles.desktopTable].filter(Boolean).join(' ')}
          data-agent-table
        >
          <table className={styles.agentTable} role="table" aria-label="Agent 运行列表">
            <caption className="sr-only">Agent 运行列表</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  Agent
                </th>
                <th role="columnheader" scope="col">
                  状态
                </th>
                <th role="columnheader" scope="col">
                  Token
                </th>
                <th role="columnheader" scope="col">
                  估算成本
                </th>
                <th role="columnheader" scope="col">
                  时间
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {diagnostics.agentRuns.length === 0 ? (
                <tr role="row">
                  <td role="cell" className={dataTableStyles.empty} colSpan={5}>
                    <strong>暂无 Agent 运行记录</strong>
                    <span>简历提取、匹配或建议生成后，运行记录会显示在这里。</span>
                  </td>
                </tr>
              ) : (
                diagnostics.agentRuns.map((run) => (
                  <DiagnosticRecord key={run.id}>
                    <td role="cell" className={styles.cardTitle}>
                      <AgentRunDetailsDialog run={run} />
                    </td>
                    <td role="cell">
                      <span className={`status status-${run.status}`}>
                        {labelStatus(agentRunStatusLabels, run.status)}
                      </span>
                    </td>
                    <td role="cell" className={styles.desktopOnly}>
                      {run.inputTokens ?? '—'} / {run.outputTokens ?? '—'}
                    </td>
                    <td role="cell" className={styles.desktopOnly}>
                      {/* 未报告用量的请求不抹去已知费用，实际缺价继续明示。 */}
                      {run.estimatedCostMicros !== null
                        ? formatCost(run.estimatedCostMicros, run.costCurrency, displayCurrency)
                        : (run.hasUnpricedRequests ??
                            run.pricingVersion?.split(',').includes('unpriced'))
                          ? '未定价'
                          : formatCost(
                              run.knownCostMicros ?? null,
                              run.costCurrency,
                              displayCurrency,
                            )}
                    </td>
                    <td role="cell" className={styles.cardTime}>
                      {time(run.startedAt)}
                    </td>
                  </DiagnosticRecord>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={diagnostics.agentPagination.total}
          pageSize={diagnostics.agentPagination.pageSize}
          pageParameter="agentPage"
          sizeParameter="agentPageSize"
          currentPage={diagnostics.agentPagination.current}
          totalPages={diagnostics.agentPagination.totalPages}
          label="Agent 运行分页"
          createHref={(page) => `/tasks${pageHref(parameters, 'agentPage', page)}`}
        />
      </section>
    </>
  );
}
