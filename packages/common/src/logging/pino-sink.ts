import { resolve } from 'node:path';
import pino, { multistream, type DestinationStream } from 'pino';
import { RotatingFileStream } from './rotating-file-stream.js';
import { PinoSafeLogger, type LogLevel, type SafeLogger } from './safe-logger.js';

/** 创建配置好脱敏、文件输出和上下文的安全日志器。 */
export function createSafeLogger(
  input: {
    readonly level?: LogLevel;
    readonly stderr?: DestinationStream;
    readonly logFile?: string;
    readonly maxFileBytes?: number;
    readonly maxFiles?: number;
  } = {},
): SafeLogger {
  const level = input.level ?? 'info';
  const streams: { level: LogLevel; stream: DestinationStream }[] = [
    { level, stream: input.stderr ?? process.stderr },
  ];
  let fileStream: RotatingFileStream | null = null;
  if (input.logFile) {
    fileStream = new RotatingFileStream({
      path: resolve(input.logFile),
      maxBytes: input.maxFileBytes ?? 10 * 1024 * 1024,
      maxFiles: input.maxFiles ?? 5,
    });
    streams.push({ level, stream: fileStream });
  }
  const logger = pino(
    { level, base: null, timestamp: pino.stdTimeFunctions.isoTime },
    multistream(streams),
  );
  return new PinoSafeLogger(logger, {}, async () => {
    await new Promise<void>((resolveFlush, reject) => {
      logger.flush((error) => {
        if (error) reject(error);
        else resolveFlush();
      });
    });
    const ownedFileStream = fileStream;
    if (ownedFileStream) {
      await new Promise<void>((resolveEnd, reject) => {
        ownedFileStream.end((error?: Error | null) => {
          if (error) reject(error);
          else resolveEnd();
        });
      });
    }
  });
}
