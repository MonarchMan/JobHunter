import { parseId, utcInstant } from '@jobhunter/common/domain';
import { SourceError } from '@jobhunter/recruitment/source-contracts';
import { z } from 'zod';
import {
  TaskExecutionError,
  type TaskErrorCategory,
  type TaskHandler,
} from '@jobhunter/common/tasks';
import type { SyncScoringStage } from '../contracts/sync-scoring.js';
import type { JobSyncService } from './job-sync-service.js';

/** 单个来源的发现阶段输出。 */
const sourceSyncRunOutputSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    runId: z.string().trim().min(1),
    status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
    coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
  })
  .strict();

/** 评分阶段单项结果，与 SyncScoringItemRecord 同构。 */
const scoringItemSchema = z
  .object({
    jobId: z.string().trim().min(1),
    status: z.enum(['succeeded', 'failed']),
    result: z.unknown(),
    error: z.string().nullable(),
  })
  .strict();

/** 评分阶段进度，与 SyncScoringProgress 同构。 */
const scoringProgressSchema = z
  .object({
    items: z.array(scoringItemSchema).max(1000),
    degraded: z.number().int().nonnegative(),
  })
  .strict();

/** 恢复快照：已完成的发现运行、跨尝试累计的可评分职位和评分进度；仅由 retryPayload 写入。 */
const syncResumeSchema = z
  .object({
    runs: z.array(sourceSyncRunOutputSchema).min(1).max(10),
    accJobIds: z.array(z.string().trim().min(1)).max(1000),
    scoring: scoringProgressSchema.optional(),
  })
  .strict();

const triggerSchema = z.enum(['manual', 'schedule', 'retry']);

/** 来源同步任务输入；resume 字段只出现在重试恢复路径，入口不得提供。 */
export const sourceSyncTaskPayloadSchema = z.union([
  z
    .object({
      sourceId: z.string().trim().min(1),
      trigger: triggerSchema,
      resume: syncResumeSchema.optional(),
    })
    .strict(),
  z
    .object({
      sourceIds: z.array(z.string().trim().min(1)).min(2).max(10),
      trigger: triggerSchema,
      resume: syncResumeSchema.optional(),
    })
    .refine((payload) => new Set(payload.sourceIds).size === payload.sourceIds.length)
    .strict(),
]);

/** 输出中评分阶段的可选扩展字段。 */
const scoringOutputFields = {
  scoring: scoringProgressSchema.optional(),
  /** 评分阶段整体跳过的原因；执行过评分（含部分失败）时缺省。 */
  skippedReason: z.enum(['disabled', 'no_profile']).optional(),
} as const;

/** 来源同步任务输出：发现运行结果加可选的评分阶段进度；旧行没有评分字段，天然兼容。 */
export const sourceSyncTaskOutputSchema = z.union([
  z
    .object({
      runId: z.string().trim().min(1),
      status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'conflict']),
      coverage: z.enum(['complete', 'partial', 'unknown']).nullable(),
      ...scoringOutputFields,
    })
    .strict(),
  z
    .object({
      runs: z.array(sourceSyncRunOutputSchema).min(2).max(10),
      ...scoringOutputFields,
    })
    .strict(),
]);

/** 任务检查点形状：比最终输出多携带 accJobIds，供恢复时确定评分范围。 */
const checkpointResultSchema = z
  .object({
    runs: z.array(sourceSyncRunOutputSchema).min(1).max(10),
    accJobIds: z.array(z.string().trim().min(1)).max(1000),
    scoring: scoringProgressSchema.optional(),
  })
  .strict();

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function taskErrorCategory(sourceCategory: string | null): TaskErrorCategory {
  switch (sourceCategory) {
    case 'temporary':
      return 'network_temporary';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_config':
      return 'invalid_config';
    case 'parse_changed':
      return 'parse_changed';
    case 'cancelled':
      return 'cancelled';
    case 'access_blocked':
    case 'not_found':
    case 'isolated_items':
    case 'internal':
    default:
      return 'permanent';
  }
}

/** 应用层使用的类型约束。 */
type RunOutput = z.infer<typeof sourceSyncRunOutputSchema>;

/** 应用层使用的类型约束。 */
type ScoringProgress = z.infer<typeof scoringProgressSchema>;

/**
 * 执行单来源发现阶段并把失败分类为任务错误。
 * 成功返回运行输出与本运行新增/修订职位；失败抛出后由调用方决定单来源直抛或多来源收集。
 */
async function runDiscoveryStage(
  service: Pick<JobSyncService, 'run'>,
  input: { readonly sourceId: string; readonly trigger: 'manual' | 'schedule' | 'retry' },
  signal: AbortSignal,
): Promise<{ readonly run: RunOutput; readonly scorableJobIds: readonly string[] }> {
  let result: Awaited<ReturnType<JobSyncService['run']>>;
  try {
    result = await service.run(
      { sourceId: parseId(input.sourceId, 'JobSource'), trigger: input.trigger },
      signal,
    );
  } catch (error) {
    if (error instanceof SourceError) {
      throw new TaskExecutionError(taskErrorCategory(error.category), error.safeDiagnostic, {
        cause: error,
        ...(error.retryAfterAt === null ? {} : { retryAfterAt: utcInstant(error.retryAfterAt) }),
      });
    }
    throw error;
  }
  if (result.kind === 'conflict') {
    return {
      run: { sourceId: input.sourceId, runId: result.runId, status: 'conflict', coverage: null },
      scorableJobIds: [],
    };
  }
  if (
    result.status === 'failed' ||
    (result.status === 'partial' &&
      (result.errorCategory === 'temporary' ||
        result.errorCategory === 'rate_limited' ||
        result.failureCause !== undefined))
  ) {
    throw new TaskExecutionError(
      taskErrorCategory(result.errorCategory),
      result.errorSummary ?? 'Source synchronization failed.',
      { cause: result.failureCause },
    );
  }
  if (result.status === 'cancelled') {
    throw new TaskExecutionError('cancelled', 'Source synchronization was cancelled.');
  }
  return {
    run: {
      sourceId: input.sourceId,
      runId: result.runId,
      status: result.status,
      coverage: result.coverage,
    },
    scorableJobIds: result.scorableJobIds,
  };
}

/** 依据已保存的检查点构造恢复输入；无有效检查点时整任务重跑。 */
function withResumeFromCheckpoint(value: unknown, result: unknown): unknown {
  const parsed = sourceSyncTaskPayloadSchema.safeParse(value);
  if (!parsed.success) return value;
  const checkpoint = checkpointResultSchema.safeParse(result);
  if (!checkpoint.success) return value;
  const { resume: _resume, ...base } = parsed.data;
  void _resume;
  const { runs, accJobIds, scoring } = checkpoint.data;
  // 1、发现与评分进度一并写入恢复快照，执行时跳过已完成来源与已成功职位。
  return { ...base, resume: { runs, accJobIds, ...(scoring ? { scoring } : {}) } };
}

/** 创建来源同步任务处理器：阶段 A 抓取发现，阶段 B 在同一任务内执行自动评分（ADR-0061）。 */
export function createSourceSyncTaskHandler(
  // 1、校验来源快照；2、执行发现阶段并按检查点恢复；3、注入的评分阶段逐项评分；4、失败分类为可重试或终态。
  service: Pick<JobSyncService, 'run'>,
  options: { readonly scoringStage?: SyncScoringStage } = {},
): TaskHandler<
  z.infer<typeof sourceSyncTaskPayloadSchema>,
  z.infer<typeof sourceSyncTaskOutputSchema>
> {
  return {
    taskType: 'source.sync',
    payloadSchema: sourceSyncTaskPayloadSchema,
    outputSchema: sourceSyncTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 10 * 60_000,
    concurrencyKey: (payload) =>
      `source-sync:${'sourceId' in payload ? payload.sourceId : [...payload.sourceIds].sort().join('|')}`,
    retryPayload: withResumeFromCheckpoint,
    manualRetryPayload: withResumeFromCheckpoint,
    /** 执行应用适配器的该项操作。 */
    async execute(context, payload) {
      const requestedIds = 'sourceId' in payload ? [payload.sourceId] : payload.sourceIds;
      const multi = !('sourceId' in payload);
      const resume = payload.resume ?? null;
      // 1、发现阶段：恢复快照中的来源直接跳过；多来源每完成一个来源落一次检查点。
      const runs: RunOutput[] = [...(resume?.runs ?? [])];
      const discovered = new Set(runs.map((run) => run.sourceId));
      let accJobIds: string[] = [...(resume?.accJobIds ?? [])];
      const failures: { error: unknown }[] = [];
      for (const sourceId of requestedIds) {
        if (discovered.has(sourceId)) continue;
        context.signal.throwIfAborted();
        try {
          const stage = await runDiscoveryStage(
            service,
            { sourceId, trigger: payload.trigger },
            context.signal,
          );
          runs.push(stage.run);
          accJobIds.push(...stage.scorableJobIds);
        } catch (error) {
          if (error instanceof TaskExecutionError && error.category === 'cancelled') throw error;
          if (!multi) throw error;
          failures.push({ error });
        }
        if (multi) {
          context.checkpoint?.({ runs, accJobIds: [...new Set(accJobIds)] });
        }
      }
      // 2、聚合运行全部结束后再失败，使同一任务重试时不会漏掉后续来源。
      const first = failures[0];
      if (first) throw first.error;
      accJobIds = [...new Set(accJobIds)];

      // 3、评分阶段：发现完成先落检查点，评分中途崩溃恢复不再重跑发现。
      let scoring: ScoringProgress | null = resume?.scoring ?? null;
      let skippedReason: 'disabled' | 'no_profile' | undefined;
      if (options.scoringStage && accJobIds.length > 0) {
        context.checkpoint?.({
          runs,
          accJobIds,
          ...(scoring ? { scoring } : {}),
        });
        // 评分实现不得直接写任务级检查点，只能经回调合并运行结果后落库。
        const { checkpoint: _checkpoint, ...stageContext } = context;
        void _checkpoint;
        try {
          const outcome = await options.scoringStage.run({
            context: stageContext,
            jobIds: accJobIds,
            previous: scoring,
            checkpoint: (progress) => {
              context.checkpoint?.({ runs, accJobIds, scoring: progress });
            },
          });
          if (outcome.kind === 'completed') {
            scoring = {
              items: [...outcome.progress.items],
              degraded: outcome.progress.degraded,
            };
          } else skippedReason = outcome.reason;
        } catch (error) {
          // 3.a、评分阶段取消：保留已提交的发现与逐项进度，便于诊断与手动重试续跑。
          if (error instanceof TaskExecutionError && error.category === 'cancelled') {
            const partial = scoringProgressSchema.safeParse(error.result);
            throw new TaskExecutionError('cancelled', error.safeSummary, {
              result: {
                runs,
                accJobIds,
                ...(partial.success ? { scoring: partial.data } : {}),
              },
            });
          }
          throw error;
        }
      }

      // 4、评分失败不掩盖已提交的同步；摘要明示进度，重试只补跑失败项。
      if (scoring) {
        const total = scoring.items.length;
        const failed = scoring.items.filter((item) => item.status === 'failed').length;
        if (failed > 0) {
          throw new TaskExecutionError(
            'network_temporary',
            `同步已提交；评分 ${String(total - failed)}/${String(total)} 完成。`,
            { retryable: true, result: { runs, accJobIds, scoring } },
          );
        }
      }
      const scoringFields = {
        ...(scoring ? { scoring } : {}),
        ...(skippedReason ? { skippedReason } : {}),
      };
      if (!multi) {
        const run = runs[0];
        if (!run) throw new Error('Source sync finished without a run output.');
        return {
          runId: run.runId,
          status: run.status,
          coverage: run.coverage,
          ...scoringFields,
        };
      }
      return { runs, ...scoringFields };
    },
  };
}
