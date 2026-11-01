import { modelBillingSchema } from '@jobhunter/common/web-contracts';
import { z } from 'zod';
import {
  recruitmentScheduleActivityTypeSchema,
  recruitmentScheduleTimePrecisionSchema,
  recruitmentScheduleTimezoneSourceSchema,
} from '../domain/index.js';
import { webPaginationSchema } from '@jobhunter/common/web-contracts';

/** 招聘来源运行摘要 Schema。 */
const webSourceRunSchema = z
  .object({
    id: z.string(),
    status: z.enum(['running', 'succeeded', 'partial', 'failed', 'cancelled']),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    stats: z.record(z.string(), z.number()),
    errorCategory: z.string().nullable(),
    errorSummary: z.string().nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict();

/** 招聘来源配置与健康状态 Schema。 */
export const webSourceSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    channelId: z.uuid(),
    companyName: z.string(),
    officialUrl: z.url({ protocol: /^https$/ }),
    slug: z.string(),
    adapterKey: z.string(),
    coverageRole: z.enum(['required', 'supplemental']),
    recruitmentType: z.enum(['social', 'campus', 'mixed']),
    recruitmentChannels: z
      .array(z.enum(['internship', 'campus', 'social']))
      .min(1)
      .max(3),
    enabled: z.boolean(),
    effectiveEnabled: z.boolean(),
    supportStatus: z.enum(['experimental', 'supported', 'blocked']),
    healthStatus: z.enum(['unknown', 'healthy', 'degraded', 'unhealthy']),
    consecutiveFailures: z.number().int().nonnegative(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastFailureAt: z.iso.datetime().nullable(),
    latestRun: webSourceRunSchema.nullable(),
    schedule: z
      .object({
        cronExpression: z.string(),
        timezone: z.string(),
        enabled: z.boolean(),
        nextRunAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSource = z.infer<typeof webSourceSchema>;

/** 招聘来源渠道及其适配器列表 Schema。 */
export const webSourceChannelSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string(),
    slug: z.string(),
    channel: z.enum(['intern', 'campus', 'social']),
    enabled: z.boolean(),
    effectiveEnabled: z.boolean(),
    supportNote: z.string().nullable(),
    supportStatus: z.enum(['experimental', 'supported', 'blocked']),
    healthStatus: z.enum(['unknown', 'healthy', 'degraded', 'unhealthy']),
    sources: z.array(webSourceSchema),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSourceChannel = z.infer<typeof webSourceChannelSchema>;

/** 来源渠道操作请求 Schema。 */
export const webSourceChannelMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('sync'),
      channelId: z.uuid(),
      idempotencyToken: z.string().trim().min(8).max(200),
    })
    .strict(),
  z.object({ kind: z.literal('enable'), channelId: z.uuid(), enabled: z.boolean() }).strict(),
]);

/** 应用层使用的类型约束。 */
export type WebSourceChannelMutation = z.infer<typeof webSourceChannelMutationSchema>;

/** 单个招聘来源操作请求 Schema。 */
export const webSourceMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['sync', 'health']),
      sourceId: z.uuid(),
      idempotencyToken: z.string().trim().min(8).max(200),
    })
    .strict(),
  z.object({ kind: z.literal('enable'), sourceId: z.uuid(), enabled: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('schedule'),
      sourceId: z.uuid(),
      cronExpression: z.string().trim().min(1).max(100),
      timezone: z.string().trim().min(1).max(100).default('Asia/Shanghai'),
      enabled: z.boolean(),
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebSourceMutation = z.infer<typeof webSourceMutationSchema>;

/** 系统设置展示 Schema。 */
export const webSettingsSchema = z
  .object({
    jobUnderstanding: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
    sourceSync: z
      .object({
        channel: z.enum(['intern', 'campus', 'social']),
      })
      .strict(),
    sourceAutomation: z
      .object({
        enabled: z.boolean(),
        frequency: z.enum(['daily', 'weekly']),
        time: z.string(),
      })
      .strict(),
    matchingAutomation: z
      .object({ scoreEnabled: z.boolean(), adviceEnabled: z.boolean() })
      .strict(),
    jobListPreferences: z
      .object({
        defaultSort: z.enum(['updated_desc', 'published_desc', 'score_desc']),
        rememberFilters: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSettings = z.infer<typeof webSettingsSchema>;

/** 系统设置修改请求 Schema。 */
export const webSettingsMutationSchema = z
  .object({
    jobUnderstandingEnabled: z.boolean(),
    sourceSyncChannel: z.enum(['intern', 'campus', 'social']),
    sourceAutomationEnabled: z.boolean(),
    sourceAutomationFrequency: z.enum(['daily', 'weekly']),
    sourceAutomationTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    automaticScoringEnabled: z.boolean(),
    automaticAdviceEnabled: z.boolean(),
    defaultJobSort: z.enum(['updated_desc', 'published_desc', 'score_desc']),
    rememberJobFilters: z.boolean(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSettingsMutation = z.infer<typeof webSettingsMutationSchema>;

/** Web 任务状态枚举 Schema。 */
const webTaskStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

const webSourceSyncRunDetailSchema = z
  .object({
    id: z.string().trim().min(1),
    status: z.enum(['running', 'succeeded', 'partial', 'failed', 'cancelled']),
    coverage: z.enum(['complete', 'partial', 'unknown']),
    stats: z
      .object({
        discovered: z.number().int().nonnegative(),
        created: z.number().int().nonnegative(),
        revised: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
        skippedNonDomestic: z.number().int().nonnegative(),
        skippedOutOfScope: z.number().int().nonnegative(),
        skippedUnknownRegion: z.number().int().nonnegative(),
        isolated: z.number().int().nonnegative(),
        restored: z.number().int().nonnegative(),
        staled: z.number().int().nonnegative(),
        closed: z.number().int().nonnegative(),
        followupEnqueued: z.number().int().nonnegative(),
      })
      .strict(),
    errorCategory: z.string().nullable(),
    errorSummary: z.string().nullable(),
  })
  .strict();

const webSourceSyncSourceDetailSchema = z
  .object({
    companyName: z.string().trim().min(1),
    channel: z.enum(['intern', 'campus', 'social']),
    sourceSlug: z.string().trim().min(1),
    adapterKey: z.string().trim().min(1),
    trigger: z.enum(['manual', 'schedule', 'retry']),
    run: webSourceSyncRunDetailSchema.nullable(),
  })
  .strict();

/** 来源同步任务详情 Schema，聚合任务按物理来源分别列出执行结果。 */
export const webSourceSyncTaskDetailSchema = webSourceSyncSourceDetailSchema
  .extend({
    sources: z.array(webSourceSyncSourceDetailSchema).optional(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSourceSyncTaskDetail = z.infer<typeof webSourceSyncTaskDetailSchema>;

/** 职位详情批处理任务摘要 Schema。 */
export const webJobDetailBatchSchema = z
  .object({
    runId: z.string().trim().min(1),
    companyName: z.string().trim().min(1),
    channel: z.enum(['intern', 'campus', 'social']),
    sourceSlug: z.string().trim().min(1),
    counts: z
      .object({
        total: z.number().int().positive(),
        pending: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobDetailBatch = z.infer<typeof webJobDetailBatchSchema>;

/** 通用任务详情 Schema。 */
export const webTaskSchema = z
  .object({
    kind: z.enum(['task', 'source_job_detail_batch']),
    id: z.uuid(),
    taskType: z.string(),
    status: webTaskStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    retryOfTaskId: z.uuid().nullable(),
    errorCategory: z.string().nullable(),
    errorSummary: z.string().nullable(),
    cancelRequested: z.boolean(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    sourceSync: webSourceSyncTaskDetailSchema.nullable(),
    jobDetailBatch: webJobDetailBatchSchema.nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebTask = z.infer<typeof webTaskSchema>;

/** Agent 运行摘要 Schema。 */
export const webAgentRunSummarySchema = z
  .object({
    id: z.uuid(),
    agentKey: z.string(),
    agentVersion: z.string(),
    promptVersion: z.string(),
    modelConfigHash: z.string(),
    status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
    errorCategory: z.string().nullable(),
    errorSummary: z.string().nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    estimatedCostMicros: z.number().int().nonnegative().nullable(),
    costCurrency: z.string().nullable(),
    pricingVersion: z.string().nullable(),
    billingCalls: z.array(modelBillingSchema).nullable().optional(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict();

/** Agent 运行详情及工具调用 Schema。 */
export const webAgentRunDetailSchema = webAgentRunSummarySchema
  .extend({
    toolCalls: z.array(
      z
        .object({
          sequenceNumber: z.number().int().nonnegative(),
          toolKey: z.string(),
          status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
          durationMs: z.number().int().nonnegative().nullable(),
          errorSummary: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebAgentRunSummary = z.infer<typeof webAgentRunSummarySchema>;
/** 应用层使用的类型约束。 */
export type WebAgentRunDetail = z.infer<typeof webAgentRunDetailSchema>;

/** 任务与 Agent 诊断数据 Schema。 */
export const webDiagnosticsSchema = z
  .object({
    tasks: z.array(webTaskSchema),
    taskPagination: webPaginationSchema,
    agentRuns: z.array(webAgentRunSummarySchema),
    agentPagination: webPaginationSchema,
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebDiagnostics = z.infer<typeof webDiagnosticsSchema>;

/** 任务取消或重试请求 Schema。 */
export const webTaskMutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancel'), taskId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('retry'),
      taskId: z.uuid(),
      idempotencyToken: z.string().trim().min(8).max(200),
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebTaskMutation = z.infer<typeof webTaskMutationSchema>;

/** 招聘日历日期范围查询；起止日期均按用户时区解释且包含结束日。 */
export const webCalendarQuerySchema = z
  .object({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    timezone: z.string().trim().min(1).max(100).default('Asia/Shanghai'),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.dateFrom > input.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'dateTo must not be earlier than dateFrom.',
      });
    }
  });
export type WebCalendarQuery = z.infer<typeof webCalendarQuerySchema>;

/** 日程相对当前时间的派生状态，不表示用户是否实际参加或提交。 */
export const webCalendarTimingStatusSchema = z.enum(['upcoming', 'completed']);
export type WebCalendarTimingStatus = z.infer<typeof webCalendarTimingStatusSchema>;

/** Web 日历中的当前有效安排；改期只更新来源和时间，不暴露旧日程状态。 */
export const webCalendarItemSchema = z
  .object({
    id: z.string().min(1),
    sourceEventId: z.string().min(1),
    applicationId: z.string().min(1),
    companyName: z.string().min(1),
    roleTitle: z.string().min(1),
    activityType: recruitmentScheduleActivityTypeSchema,
    timingStatus: webCalendarTimingStatusSchema,
    stageLabel: z.string().min(1).max(320).nullable(),
    scheduledStartAt: z.iso.datetime().nullable(),
    scheduledEndAt: z.iso.datetime().nullable(),
    deadlineAt: z.iso.datetime().nullable(),
    scheduledStartLocalDate: z.iso.date().nullable(),
    scheduledEndLocalDate: z.iso.date().nullable(),
    deadlineLocalDate: z.iso.date().nullable(),
    timePrecision: recruitmentScheduleTimePrecisionSchema,
    timezoneSource: recruitmentScheduleTimezoneSourceSchema,
    timezoneText: z.string().min(1).max(128).nullable(),
    location: z.string().nullable(),
    meetingUrl: z.url().nullable(),
    actionUrl: z.url().nullable(),
    receivedAt: z.iso.datetime(),
  })
  .strict();
export type WebCalendarItem = z.infer<typeof webCalendarItemSchema>;

/** Web 日历日期范围响应。 */
export const webCalendarRangeSchema = z
  .object({
    items: z.array(webCalendarItemSchema),
  })
  .strict();
export type WebCalendarRange = z.infer<typeof webCalendarRangeSchema>;
