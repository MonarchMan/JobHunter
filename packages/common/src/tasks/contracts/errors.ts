import { z } from 'zod';

/** 队列、后台检查点与页面共享的纯错误分类契约。 */
export const taskErrorCategorySchema = z.enum([
  'rate_limited',
  'network_temporary',
  'io_temporary',
  'upstream_5xx',
  'parse_changed',
  'invalid_config',
  'validation_failed',
  'cancelled',
  'permanent',
]);
export type TaskErrorCategory = z.infer<typeof taskErrorCategorySchema>;
