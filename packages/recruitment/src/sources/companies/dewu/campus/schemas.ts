import { z } from 'zod';

/** 得物校园招聘职位响应 Schema。 */
export const dewuCampusJobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    location: z.string().nullable().optional(),
    detailUrl: z.url({ protocol: /^https$/ }),
  })
  .loose();

/** 来源适配器使用的类型约束。 */
export type DewuCampusJob = z.infer<typeof dewuCampusJobSchema>;
