import { z } from 'zod';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import {
  ResumeDeletionConfirmationError,
  ResumeDeletionNotFoundError,
  type ResumeDeletionService,
} from './resume-deletion-service.js';

const deletionCountsSchema = z
  .object({
    profiles: z.number().int().nonnegative(),
    profileVersions: z.number().int().nonnegative(),
    resumeDocuments: z.number().int().nonnegative(),
    matchResults: z.number().int().nonnegative(),
    agentRuns: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
  })
  .strict();

/** 简历删除任务输入，绑定已确认的影响哈希。 */
export const resumeDeletionTaskPayloadSchema = z
  .object({
    resumeDocumentId: z.string().trim().min(1),
    expectedImpactHash: z.string().length(64),
  })
  .strict();

/** 简历删除任务输出统计。 */
export const resumeDeletionTaskOutputSchema = z
  .object({
    impactHash: z.string().length(64),
    deleted: deletionCountsSchema,
    pendingArtifactPurgeIds: z.array(z.string()),
  })
  .strict();

/** 应用层输入输出的运行时校验 Schema。 */
export const artifactPurgeTaskPayloadSchema = z
  .object({ artifactId: z.string().trim().min(1) })
  .strict();

/** 应用层输入输出的运行时校验 Schema。 */
export const artifactPurgeTaskOutputSchema = z
  .object({ status: z.enum(['purged', 'already_purged']) })
  .strict();

/** 创建简历删除任务处理器，隔离数据库删除和物理文件清理。 */
export function createResumeDeletionTaskHandler(
  // 1、校验删除快照；2、隔离物理文件；3、提交事务删除；4、处理清理失败。
  service: ResumeDeletionService,
): TaskHandler<
  z.infer<typeof resumeDeletionTaskPayloadSchema>,
  z.infer<typeof resumeDeletionTaskOutputSchema>
> {
  return {
    taskType: 'resume.delete.confirmed',
    payloadSchema: resumeDeletionTaskPayloadSchema,
    outputSchema: resumeDeletionTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `resume-delete:${payload.resumeDocumentId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(_context, payload) {
      try {
        const result = await service.deleteConfirmed(payload);
        return {
          ...result,
          pendingArtifactPurgeIds: [...result.pendingArtifactPurgeIds],
        };
      } catch (error) {
        if (
          error instanceof ResumeDeletionConfirmationError ||
          error instanceof ResumeDeletionNotFoundError
        ) {
          throw new TaskExecutionError('validation_failed', error.message, { cause: error });
        }
        throw new TaskExecutionError('io_temporary', 'Confirmed resume deletion failed.', {
          cause: error,
        });
      }
    },
  };
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
export function createArtifactPurgeTaskHandler(
  service: ResumeDeletionService,
): TaskHandler<
  z.infer<typeof artifactPurgeTaskPayloadSchema>,
  z.infer<typeof artifactPurgeTaskOutputSchema>
> {
  return {
    taskType: 'resume.artifact.purge',
    payloadSchema: artifactPurgeTaskPayloadSchema,
    outputSchema: artifactPurgeTaskOutputSchema,
    defaultMaxAttempts: 5,
    leaseDurationMs: 60_000,
    concurrencyKey: (payload) => `artifact-purge:${payload.artifactId}`,
    /** 执行应用适配器的该项操作。 */
    async execute(_context, payload) {
      try {
        return { status: await service.retryArtifactPurge(payload.artifactId) };
      } catch (error) {
        throw new TaskExecutionError('io_temporary', 'Deleted resume artifact purge failed.', {
          cause: error,
        });
      }
    },
  };
}
