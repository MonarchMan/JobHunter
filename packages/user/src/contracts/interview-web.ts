import { z } from 'zod';

/** 创建项目拷打档案请求。 */
export const webCreateProjectDossierSchema = z
  .object({
    profileVersionId: z.uuid(),
    projectIndex: z.number().int().nonnegative(),
    expectedProjectHash: z.string().length(64),
  })
  .strict();

/** 提交项目拷打回答请求。 */
export const webSubmitDrillAnswerSchema = z
  .object({
    sessionId: z.uuid(),
    answer: z.string().trim().min(1).max(20_000),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 启动指定档位拷打会话请求。 */
export const webStartDrillSessionSchema = z
  .object({
    profileKey: z.enum(['resume-only', 'docs-grounded']).default('resume-only'),
    materialFileIds: z.array(z.uuid()).max(8).default([]),
  })
  .strict();

/** 项目拷打会话状态响应。 */
export const webDrillSessionStateSchema = z
  .object({ action: z.enum(['pause', 'resume', 'complete']) })
  .strict();

/** 删除项目拷打档案请求。 */
export const webDeleteProjectDossierSchema = z
  .object({
    expectedImpactHash: z.string().length(64),
    confirmation: z.literal('DELETE'),
  })
  .strict();
