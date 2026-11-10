import { open, opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { z } from 'zod';
import { redactLogValue } from './redaction.js';

/** 公开筛选只接受精确身份，不接受用户指定文件路径。 */
export const logQuerySchema = z.object({
  taskId: z.string().max(256).optional(),
  correlationId: z.string().max(256).optional(),
  agentRunId: z.string().max(256).optional(),
  modelRequestId: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type LogQuery = z.input<typeof logQuerySchema>;
/** 查询返回扫描限制，不能把截断的时间线误认为完整历史。 */
export interface LogQueryResult {
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly truncated: boolean;
  readonly scannedFiles: number;
  readonly skippedLines: number;
}
/** 只读固定目录下的受控日志，拒绝符号链接，有界扫描并重新脱敏导出。 */
export async function queryLogFiles(
  dataRoot: string,
  input: LogQuery = {},
): Promise<LogQueryResult> {
  const query = logQuerySchema.parse(input);
  const directory = path.join(dataRoot, 'logs');
  const events: Record<string, unknown>[] = [];
  let truncated = false,
    scannedFiles = 0,
    skippedLines = 0,
    remaining = 32 * 1024 * 1024;
  const names: string[] = [];
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Log directory must not be a symbolic link');
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (names.length >= 4096) {
        truncated = true;
        break;
      }
      names.push(entry.name);
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return { events, truncated, scannedFiles, skippedLines };
    throw error;
  }
  const candidates = [];
  for (const name of names) {
    if (!/^(?:jobhunter|web-\d+-[a-f0-9-]+)\.log(?:\.\d+)?$/.test(name)) continue;
    const file = path.join(directory, name);
    try {
      const stat = await lstat(file);
      if (stat.isFile() && !stat.isSymbolicLink())
        candidates.push({ file, modified: stat.mtimeMs });
    } catch {
      truncated = true;
    }
  }
  candidates.sort((a, b) => b.modified - a.modified);
  if (candidates.length > 64) truncated = true;
  for (const { file } of candidates.slice(0, 64)) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) continue;
        const size = Math.min(stat.size, remaining, 10 * 1024 * 1024);
        const start = stat.size - size;
        if (start > 0) truncated = true;
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, size, start);
        remaining -= bytesRead;
        scannedFiles++;
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
        if (start > 0) lines.shift();
        for (const line of lines) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line) > 65_536) {
            skippedLines++;
            continue;
          }
          try {
            const record: unknown = JSON.parse(line);
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
              skippedLines++;
              continue;
            }
            const row = record as Record<string, unknown>;
            if (typeof row.time !== 'string' || !Number.isFinite(Date.parse(row.time))) {
              skippedLines++;
              continue;
            }
            if (
              ['taskId', 'correlationId', 'agentRunId', 'modelRequestId'].some(
                (key) =>
                  query[key as keyof LogQuery] !== undefined &&
                  row[key] !== query[key as keyof LogQuery],
              )
            )
              continue;
            events.push(redactLogValue(row) as Record<string, unknown>);
            if (events.length > query.limit * 2) {
              events.sort(compareTime);
              events.splice(0, events.length - query.limit);
              truncated = true;
            }
          } catch {
            skippedLines++;
          }
        }
      } finally {
        await handle.close();
      }
    } catch {
      truncated = true;
    }
  }
  events.sort(compareTime);
  if (events.length > query.limit) {
    events.splice(0, events.length - query.limit);
    truncated = true;
  }
  return { events, truncated, scannedFiles, skippedLines };
}
/** 优先使用来源时间，宿主接收时间仅作为旧记录的回退。 */
function compareTime(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return Date.parse(String(a.originTime ?? a.time)) - Date.parse(String(b.originTime ?? b.time));
}
