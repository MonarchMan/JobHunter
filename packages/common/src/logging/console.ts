import type { DestinationStream } from 'pino';

const labels: Readonly<Record<string, string>> = {
  'task.started': '任务开始',
  'task.finished': '任务完成',
  'task.failed': '任务失败',
  'task.retry_scheduled': '任务将重试',
  'worker.queue_busy': '数据库繁忙',
  'web.request_failed': '请求处理失败',
  'thread.execution_failed': '线程任务失败',
  'thread.startup_failed': '工作线程启动失败',
  'logging.degraded': '日志文件不可用，已降级至控制台',
};
/** 仅显示标量，禁止把未知对象隐式转换成无意义文本。 */
function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}
/** 终端只展示摘要和定位身份；不把完整堆栈与业务正文铺满控制台。 */
export function formatLogLine(record: Readonly<Record<string, unknown>>): string {
  const level =
    Number(record.level) >= 50
      ? '错误'
      : Number(record.level) >= 40
        ? '警告'
        : Number(record.level) >= 30
          ? '信息'
          : '调试';
  const event = scalar(record.event ?? record.msg) || 'unknown';
  const identity = [
    'taskType',
    'taskId',
    'attempt',
    'correlationId',
    'agentRunId',
    'modelRequestId',
  ]
    .filter((key) => record[key] !== undefined)
    .map((key) => `${key}=${String(record[key])}`)
    .join(' ');
  return `${scalar(record.time)} ${level} ${labels[event] ?? event}${identity ? ` · ${identity}` : ''}${record.suppressed ? ` · 合并 ${scalar(record.suppressed)} 条` : ''}\n`;
}
/** 仅对反复锁忙告警合并；上限与关闭汇总避免静默丢失和无界状态。 */
export function consoleDestination(
  destination: DestinationStream,
  pretty: boolean,
): DestinationStream & { flushSummary(): void } {
  let windowStart = 0,
    suppressed = 0;
  let latest: Record<string, unknown> = {};
  const write = (record: Record<string, unknown>): void => {
    destination.write(pretty ? formatLogLine(record) : `${JSON.stringify(record)}\n`);
  };
  const flushSummary = (): void => {
    if (suppressed) {
      write({ ...latest, suppressed });
      suppressed = 0;
    }
  };
  return {
    write(line) {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.event === 'worker.queue_busy') {
        latest = record;
        if (Date.now() - windowStart < 30_000) {
          suppressed++;
          return;
        }
        flushSummary();
        windowStart = Date.now();
      }
      write(record);
    },
    flushSummary,
  };
}
