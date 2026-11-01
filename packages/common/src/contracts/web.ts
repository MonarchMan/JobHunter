import { z } from 'zod';

/** Stable error body shared by Web route handlers and React clients. */
/** Web API 的统一错误对象。 */
export const webErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebError = z.infer<typeof webErrorSchema>;

/** 应用层使用的类型约束。 */
export type WebSuccessEnvelopeSchema<TSchema extends z.ZodType> = z.ZodObject<{
  data: TSchema;
  meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}>;

/** 为任意数据 Schema 包装统一成功响应。 */
export function webSuccessEnvelopeSchema<TSchema extends z.ZodType>(
  schema: TSchema,
): WebSuccessEnvelopeSchema<TSchema> {
  return z
    .object({
      data: schema,
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();
}

/** Web API 的统一错误响应包。 */
export const webErrorEnvelopeSchema = z
  .object({
    error: webErrorSchema,
  })
  .strict();

/** 应用层数据结构或端口契约。 */
export interface WebSuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** 应用层数据结构或端口契约。 */
export interface WebErrorEnvelope {
  readonly error: WebError;
}

/** 异步任务已接受响应。 */
export const webTaskAcceptedSchema = z
  .object({
    taskId: z.uuid(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
    deduplicated: z.boolean(),
    statusUrl: z.string().startsWith('/api/tasks/'),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebTaskAccepted = z.infer<typeof webTaskAcceptedSchema>;

/** 列表接口通用分页元数据 Schema。 */
export const webPaginationSchema = z
  .object({
    current: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebPagination = z.infer<typeof webPaginationSchema>;

/** 计算 Web 列表分页元数据。 */
export function webPagination(total: number, current: number, pageSize: number): WebPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return webPaginationSchema.parse({
    current: Math.min(Math.max(current, 1), totalPages),
    total,
    totalPages,
    pageSize,
  });
}
