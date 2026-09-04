import { z } from 'zod';
import { jobAdviceSchema, ruleOutcomeSchema, scoreComponentSchema } from '@jobhunter/matching';
import { candidatePreferencesSchema, candidateProfileSchema } from '@jobhunter/domain';
import { resumePolishAgentOutputSchema, resumePolishSectionSchema } from '@jobhunter/resume';

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

/** 简历导入响应。 */
export const webResumeImportResultSchema = z
  .object({
    document: z
      .object({
        id: z.uuid(),
        mediaType: z.string().min(1),
        parseStatus: z.enum(['parsed', 'needs_ocr', 'failed']),
        parserVersion: z.string().nullable(),
        errorSummary: z.string().nullable(),
        createdAt: z.number().int().nonnegative(),
      })
      .strict(),
    deduplicated: z.boolean(),
    profileId: z.uuid(),
    task: webTaskAcceptedSchema.nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeImportResult = z.infer<typeof webResumeImportResultSchema>;

/** 首页下一步行动卡片的联合结构。 */
export const webDashboardNextActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create_profile'),
      message: z.string(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('enable_sources'),
      message: z.string(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('review_matches'),
      message: z.string(),
      count: z.number().int().positive(),
      topJob: z
        .object({
          id: z.uuid(),
          companyName: z.string(),
          title: z.string(),
          score: z.number().min(0).max(100),
        })
        .strict()
        .nullable(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('handle_failures'),
      message: z.string(),
      count: z.number().int().positive(),
      href: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('all_good'),
      message: z.string(),
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebDashboardNextAction = z.infer<typeof webDashboardNextActionSchema>;

/** 首页高亮职位摘要 Schema。 */
export const webDashboardHighlightJobSchema = z
  .object({
    id: z.uuid(),
    companyName: z.string(),
    title: z.string(),
    locations: z.array(z.string()),
    score: z.number().min(0).max(100).nullable(),
    matchReasons: z.array(z.string()).max(3),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    isNew: z.boolean(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebDashboardHighlightJob = z.infer<typeof webDashboardHighlightJobSchema>;

/** 首页仪表盘聚合数据 Schema。 */
export const webDashboardSchema = z
  .object({
    activeJobs: z.number().int().nonnegative(),
    currentMatches: z.number().int().nonnegative(),
    sources: z.object({
      healthy: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    tasks: z.object({
      pending: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    latestSync: z
      .object({ sourceName: z.string(), status: z.string(), finishedAt: z.iso.datetime() })
      .nullable(),
    nextAction: webDashboardNextActionSchema.nullable(),
    highlightJobs: z.array(webDashboardHighlightJobSchema).max(5),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebDashboard = z.infer<typeof webDashboardSchema>;

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

/** 职位列表查询参数 Schema。 */
export const webJobQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    companies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    statuses: z
      .array(z.enum(['active', 'stale', 'closed']))
      .max(3)
      .optional(),
    locations: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    jobSubfamilies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).default('internship'),
    minimumScore: z.number().min(0).max(100).optional(),
    profileVersionId: z.uuid().optional(),
    sort: z.enum(['updated_desc', 'published_desc', 'score_desc']).default('updated_desc'),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobQuery = z.infer<typeof webJobQuerySchema>;

/** 单个职位匹配请求参数 Schema。 */
export const webJobMatchMutationSchema = z
  .object({
    profileVersionId: z.uuid().optional(),
    idempotencyToken: z.string().trim().min(8).max(200),
    mode: z.enum(['rules', 'llm']).default('rules'),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobMatchMutation = z.infer<typeof webJobMatchMutationSchema>;

/** 批量职位匹配请求参数 Schema。 */
export const webJobBulkMatchMutationSchema = webJobMatchMutationSchema
  .extend({ jobIds: z.array(z.uuid()).min(1).max(100) })
  .strict();

/** 职位列表行数据 Schema。 */
export const webJobListItemSchema = z
  .object({
    id: z.uuid(),
    companyId: z.uuid(),
    companyName: z.string(),
    title: z.string(),
    department: z.string().nullable(),
    jobFamily: z.string().nullable(),
    jobSubfamily: z.string().nullable(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).nullable(),
    locations: z.array(z.string()),
    status: z.enum(['active', 'stale', 'closed']),
    detailUrl: z.url({ protocol: /^https$/ }),
    applyUrl: z.url({ protocol: /^https$/ }),
    publishedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    score: z.number().min(0).max(100).nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobListItem = z.infer<typeof webJobListItemSchema>;

/** 职位分页结果 Schema。 */
export const webJobPageSchema = z
  .object({
    items: z.array(webJobListItemSchema),
    page: webPaginationSchema,
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobPage = z.infer<typeof webJobPageSchema>;

/** 职位修订记录 Schema。 */
/** 职位历史修订记录 Schema。 */
export const webJobRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();

/** 职位匹配结果及建议状态 Schema。 */
/** 职位匹配结果及建议状态 Schema。 */
export const webJobMatchSchema = z
  .object({
    id: z.uuid(),
    profileVersionId: z.uuid(),
    filterStatus: z.enum(['eligible', 'excluded', 'uncertain']),
    totalScore: z.number().min(0).max(100),
    components: z.array(scoreComponentSchema),
    ruleOutcomes: z.array(ruleOutcomeSchema),
    rulesetVersion: z.string(),
    createdAt: z.iso.datetime(),
    advice: z.discriminatedUnion('status', [
      z.object({ status: z.literal('available'), content: jobAdviceSchema }).strict(),
      z.object({ status: z.enum(['not_requested', 'pending', 'failed']) }).strict(),
    ]),
  })
  .strict();

/** 职位详情及历史修订、匹配结果 Schema。 */
export const webJobDetailSchema = webJobListItemSchema
  .extend({
    sourceId: z.uuid(),
    externalJobId: z.string(),
    employmentType: z.string().nullable(),
    recruitmentCategory: z.enum(['internship', 'campus', 'social']).nullable(),
    experienceText: z.string().nullable(),
    educationText: z.string().nullable(),
    description: z.string(),
    firstSeenAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    revisions: z.array(webJobRevisionSchema),
    matches: z.array(webJobMatchSchema),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebJobDetail = z.infer<typeof webJobDetailSchema>;

/** 候选人画像摘要 Schema。 */
/** 候选人画像摘要 Schema。 */
export const webProfileSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currentVersionId: z.uuid().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

/** 候选人画像版本 Schema。 */
/** 候选人画像版本 Schema。 */
export const webProfileVersionSchema = z
  .object({
    id: z.uuid(),
    profileId: z.uuid(),
    versionNumber: z.number().int().positive(),
    resumeDocumentId: z.uuid().nullable(),
    extracted: candidateProfileSchema,
    effective: candidateProfileSchema,
    lockedPaths: z.array(z.string()),
    createdAt: z.iso.datetime(),
    extractionAgent: z
      .object({
        key: z.string(),
        version: z.string(),
        promptVersion: z.string(),
        modelConfigHash: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 候选人画像详情及版本列表 Schema。 */
export const webProfileDetailSchema = z
  .object({
    profile: webProfileSummarySchema,
    current: webProfileVersionSchema,
    versions: z.array(webProfileVersionSchema),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebProfileDetail = z.infer<typeof webProfileDetailSchema>;

/** 候选人画像编辑操作 Schema。 */
export const webProfileMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('replace'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      profile: candidateProfileSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      pointer: z.string().startsWith('/').max(500),
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['lock', 'unlock']),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      pointer: z.string().startsWith('/').max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal('preferences'),
      profileId: z.uuid(),
      expectedVersionId: z.uuid(),
      preferences: candidatePreferencesSchema,
    })
    .strict(),
]);

/** 应用层使用的类型约束。 */
export type WebProfileMutation = z.infer<typeof webProfileMutationSchema>;

/** 简历润色请求 Schema。 */
/** 简历润色请求 Schema。 */
export const webResumePolishRequestSchema = z
  .object({
    profileId: z.uuid(),
    sourceVersionId: z.uuid(),
    sections: z.array(resumePolishSectionSchema).min(1).max(2),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 简历润色任务受理响应 Schema。 */
export const webResumePolishAcceptedSchema = z
  .object({
    suggestionId: z.uuid(),
    task: z
      .object({
        taskId: z.uuid(),
        status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
        deduplicated: z.boolean(),
        statusUrl: z.string().startsWith('/api/profile/polish'),
      })
      .strict(),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumePolishAccepted = z.infer<typeof webResumePolishAcceptedSchema>;

/** 简历润色任务状态响应 Schema。 */
export const webResumePolishStatusSchema = z
  .object({
    suggestionId: z.uuid(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
    errorSummary: z.string().nullable(),
    suggestion: z
      .object({
        sourceVersionId: z.uuid(),
        sections: z.array(resumePolishSectionSchema).min(1).max(2),
        result: resumePolishAgentOutputSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 应用层使用的类型约束。 */
/** 简历润色任务状态响应类型。 */
export type WebResumePolishStatus = z.infer<typeof webResumePolishStatusSchema>;

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
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSettings = z.infer<typeof webSettingsSchema>;

/** 系统设置修改请求 Schema。 */
export const webSettingsMutationSchema = z
  .object({
    jobUnderstandingEnabled: z.boolean(),
    sourceSyncChannel: z.enum(['intern', 'campus', 'social']),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebSettingsMutation = z.infer<typeof webSettingsMutationSchema>;

/** Web 任务状态枚举 Schema。 */
const webTaskStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

/** 来源同步任务详情 Schema。 */
export const webSourceSyncTaskDetailSchema = z
  .object({
    companyName: z.string().trim().min(1),
    channel: z.enum(['intern', 'campus', 'social']),
    sourceSlug: z.string().trim().min(1),
    adapterKey: z.string().trim().min(1),
    trigger: z.enum(['manual', 'schedule', 'retry']),
    run: z
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
      .strict()
      .nullable(),
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

/** 简历删除影响预览 Schema。 */
export const webResumeDeletionImpactSchema = z
  .object({
    resumeDocumentId: z.uuid(),
    impactHash: z.string().length(64),
    counts: z
      .object({
        profiles: z.number().int().nonnegative(),
        profileVersions: z.number().int().nonnegative(),
        resumeDocuments: z.number().int().nonnegative(),
        matchResults: z.number().int().nonnegative(),
        agentRuns: z.number().int().nonnegative(),
        artifacts: z.number().int().nonnegative(),
        resumeDrafts: z.number().int().nonnegative(),
        resumeExports: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeDeletionImpact = z.infer<typeof webResumeDeletionImpactSchema>;

/** 简历删除确认请求 Schema。 */
export const webResumeDeletionConfirmSchema = z
  .object({
    resumeDocumentId: z.uuid(),
    expectedImpactHash: z.string().length(64),
    confirmation: z.literal('DELETE'),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

/** 应用层使用的类型约束。 */
export type WebResumeDeletionConfirm = z.infer<typeof webResumeDeletionConfirmSchema>;
