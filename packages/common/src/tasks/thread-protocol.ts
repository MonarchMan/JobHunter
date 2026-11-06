import { z } from 'zod';

/** 线程消息只传校验后的任务与关联身份；凭据和大型正文不进入诊断。 */
export const toThreadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('execute'),
    id: z.uuid(),
    task: z
      .object({
        id: z.uuid(),
        taskType: z.string().min(1),
        leaseOwner: z.string().min(1),
        status: z.literal('running'),
        attemptCount: z.number().int().positive(),
        payload: z.unknown(),
        result: z.unknown().optional(),
      })
      .loose(),
  }),
  z.object({ kind: z.literal('abort'), id: z.uuid() }),
  z.object({ kind: z.literal('permit'), id: z.uuid() }),
  z.object({ kind: z.literal('shutdown') }),
]);

/** Worker 对象本身隔离线程代次，关联 ID 必须属于发送消息的同一 Worker。 */
export const fromThreadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('alive'),
    utilization: z.number().min(0).max(1).optional(),
    eventLoopDelayMs: z.number().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('closed') }),
  z.object({
    kind: z.literal('acquire'),
    id: z.uuid(),
    source: z
      .object({
        key: z.string().min(1).max(256),
        requestsPerMinute: z.number().positive(),
        burst: z.number().int().min(1).max(10000),
      })
      .optional(),
  }),
  z.object({ kind: z.literal('release'), id: z.uuid() }),
  z.object({ kind: z.literal('result'), id: z.uuid(), value: z.unknown().optional() }),
  z.object({
    kind: z.literal('error'),
    id: z.uuid(),
    category: z.enum([
      'rate_limited',
      'network_temporary',
      'io_temporary',
      'upstream_5xx',
      'parse_changed',
      'invalid_config',
      'validation_failed',
      'cancelled',
      'permanent',
    ]),
    summary: z.string().max(240),
    retryable: z.boolean().nullable(),
    retryAfterAt: z.number().nullable(),
    result: z.unknown().optional(),
  }),
]);

/** 单条消息上限与本机桥一致，避免无界结构化克隆。 */
export function checkThreadMessageSize(message: unknown): void {
  if (Buffer.byteLength(JSON.stringify(message)) > 1_048_576)
    throw new RangeError('Task thread message too large');
}
