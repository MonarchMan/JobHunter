import { z } from 'zod';

/** 本机任务服务协议版本；不兼容版本必须拒绝连接，不能另启第二套调度。 */
export const taskServiceProtocol = 1;
export const taskServiceRequestSchema = z
  .object({
    protocol: z.literal(taskServiceProtocol),
    id: z.uuid(),
    configuration: z.string().min(1).max(256),
    method: z.enum(['ping', 'query', 'enqueue', 'cancel', 'retry', 'shutdown']),
    input: z.unknown().optional(),
  })
  .strict();
export type TaskServiceRequest = z.infer<typeof taskServiceRequestSchema>;
export const taskServiceResponseSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.uuid(), ok: z.literal(true), value: z.unknown().optional() }).strict(),
  z
    .object({
      id: z.uuid(),
      ok: z.literal(false),
      code: z.enum(['incompatible', 'invalid_request', 'operation_failed']),
    })
    .strict(),
]);
/** 边界限制按 UTF-8 字节计算，避免无换行或超大消息耗尽宿主内存。 */
export const taskServiceMaximumMessageBytes = 1_048_576;
