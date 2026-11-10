import { resolve } from 'node:path';
import { threadId } from 'node:worker_threads';
import pino, { multistream, type DestinationStream } from 'pino';
import { RotatingFileStream } from './rotating-file-stream.js';
import { PinoSafeLogger, type LogFields, type LogLevel, type SafeLogger } from './safe-logger.js';
import { consoleDestination } from './console.js';

const levelValues: Readonly<Record<LogLevel, number>> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};
/** 转发与根 logger 均保留两个输出目标所需的最低级别。 */
export function minimumLogLevel(first: LogLevel, second: LogLevel): LogLevel {
  return levelValues[first] < levelValues[second] ? first : second;
}

/** 创建独立控制台/文件级别的安全日志；调用方负责单写入者生命周期。 */
export function createSafeLogger(
  input: {
    readonly level?: LogLevel;
    readonly context?: LogFields;
    readonly consoleLevel?: LogLevel;
    readonly format?: 'auto' | 'pretty' | 'json';
    readonly stderr?: DestinationStream;
    readonly logFile?: string;
    readonly maxFileBytes?: number;
    readonly maxFiles?: number;
  } = {},
): SafeLogger {
  const fileLevel = input.level ?? 'info';
  const consoleLevel = input.consoleLevel ?? (input.logFile ? 'warn' : fileLevel);
  const target = input.stderr ?? process.stderr;
  const pretty =
    input.format === 'pretty' || (input.format === 'auto' && !input.stderr && process.stderr.isTTY);
  const terminal = consoleDestination(target, pretty);
  let degraded = false;
  /** 降级只通知一次，不回显文件系统错误中潜在的私有路径。 */
  const degrade = (): void => {
    if (degraded) return;
    degraded = true;
    try {
      terminal.write(
        JSON.stringify({ level: 50, time: new Date().toISOString(), event: 'logging.degraded' }),
      );
    } catch {
      /* stderr 也不可用时仍不影响业务。 */
    }
  };
  let fileStream: RotatingFileStream | undefined;
  if (input.logFile) {
    try {
      fileStream = new RotatingFileStream({
        path: resolve(input.logFile),
        maxBytes: input.maxFileBytes ?? 10 * 1024 * 1024,
        maxFiles: input.maxFiles ?? 5,
      });
      fileStream.on('error', degrade);
    } catch {
      degrade();
    }
  }
  const streams: { level: LogLevel; stream: DestinationStream }[] = [
    {
      level: consoleLevel,
      stream: {
        write(line) {
          try {
            terminal.write(line);
          } catch {
            /* 控制台关闭不终止业务。 */
          }
        },
      },
    },
  ];
  if (input.logFile)
    streams.push({
      level: fileLevel,
      stream: {
        write(line) {
          if (!degraded && fileStream && !fileStream.destroyed) {
            try {
              fileStream.write(line);
            } catch {
              degrade();
            }
          } else {
            degrade();
            try {
              if ((JSON.parse(line) as { level: number }).level < levelValues[consoleLevel])
                terminal.write(line);
            } catch {
              /* 降级失败不递归记录。 */
            }
          }
        },
      },
    });
  const level = input.logFile ? minimumLogLevel(fileLevel, consoleLevel) : consoleLevel;
  const logger = pino(
    { level, base: { pid: process.pid, threadId }, timestamp: pino.stdTimeFunctions.isoTime },
    multistream(streams),
  );
  let closing: Promise<void> | undefined;
  return new PinoSafeLogger(
    logger,
    input.context ?? {},
    () =>
      (closing ??= (async () => {
        try {
          terminal.flushSummary();
        } catch {
          /* 终端提前关闭。 */
        }
        const stream = fileStream;
        if (!stream || stream.destroyed) return;
        await new Promise<void>((done) => {
          stream.once('error', done);
          stream.end(done);
        });
      })()),
  );
}
