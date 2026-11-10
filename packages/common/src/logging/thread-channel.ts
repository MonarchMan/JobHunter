import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { z } from 'zod';
import { createSafeLogger } from './pino-sink.js';
import type { LogLevel, SafeLogger } from './safe-logger.js';

const eventSchema = z
  .object({
    level: z.union([z.literal(20), z.literal(30), z.literal(40), z.literal(50)]),
    event: z.string().max(256),
  })
  .loose();
const levels = { 20: 'debug', 30: 'info', 40: 'warn', 50: 'error' } as const;
/** 专用通道由宿主消费；事件重新校验脱敏，确认代表已提交本地 sink。 */
export function createThreadLogChannel(logger: SafeLogger): { port: MessagePort; close(): void } {
  const { port1, port2 } = new MessageChannel();
  port1.on('message', (line: unknown) => {
    try {
      if (typeof line !== 'string' || Buffer.byteLength(line) > 65_536) return;
      const parsed = eventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return;
      const { level, event, time, pid, threadId, ...fields } = parsed.data;
      delete fields.msg;
      delete fields.schemaVersion;
      logger[levels[level]](event, {
        ...fields,
        originTime: time,
        originPid: pid,
        originThreadId: threadId,
      });
    } catch {
      logger.warn('logging.invalid_thread_event', {});
    } finally {
      try {
        port1.postMessage('ack');
      } catch {
        /* 线程已退出。 */
      }
    }
  });
  port1.unref();
  return {
    port: port2,
    close() {
      port1.close();
      port2.close();
    },
  };
}

/** 每线程最多 128 条在途事件；满额时计数，恢复额度后发送可观察的丢弃摘要。 */
export function createThreadLogger(port: MessagePort, level: LogLevel): SafeLogger {
  let pending = 0,
    dropped = 0,
    closed = false;
  let drained: (() => void) | undefined;
  const send = (line: string): void => {
    if (closed) return;
    if (pending >= 128) {
      dropped++;
      return;
    }
    try {
      port.postMessage(line);
      pending++;
    } catch {
      dropped++;
    }
  };
  const report = (): void => {
    if (!dropped || pending >= 128) return;
    const count = dropped;
    dropped = 0;
    send(JSON.stringify({ level: 40, event: 'logging.thread_events_dropped', dropped: count }));
  };
  port.on('message', (message: unknown) => {
    if (message !== 'ack') return;
    pending = Math.max(0, pending - 1);
    report();
    if (!pending) drained?.();
  });
  port.unref();
  const logger = createSafeLogger({ level, format: 'json', stderr: { write: send } });
  let closing: Promise<void> | undefined;
  return {
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    child: logger.child.bind(logger),
    close() {
      return (closing ??= (async () => {
        await logger.close();
        report();
        if (pending)
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 2_000);
            drained = () => {
              clearTimeout(timeout);
              resolve();
            };
          });
        // 关闭超时只追加一条固定大小通知，不因通道失联阻止退出。
        if (pending || dropped) {
          try {
            port.postMessage(
              JSON.stringify({
                level: 40,
                event: 'logging.thread_flush_timeout',
                pending,
                dropped,
              }),
            );
          } catch {
            /* 宿主已退出。 */
          }
        }
        closed = true;
        port.close();
        await logger.close();
      })());
    },
  };
}
