import type { DestinationStream } from 'pino';

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
      ? 'error'
      : Number(record.level) >= 40
        ? 'warn'
        : Number(record.level) >= 30
          ? 'info'
          : 'debug';
  const time = scalar(record.time).replace(/\.\d+Z$/u, 'Z');
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
    .map((key) => `${key}=${String(record[key])}`);
  const parts = [time, level, event, ...identity];
  if (record.suppressed) parts.push(`suppressed=${scalar(record.suppressed)}`);
  return `${parts.join(' - ')}\n`;
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
