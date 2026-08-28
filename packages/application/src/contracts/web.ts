import { z } from 'zod';
import { jobAdviceSchema, ruleOutcomeSchema, scoreComponentSchema } from '@jobhunter/matching';
import { candidatePreferencesSchema, candidateProfileSchema } from '@jobhunter/domain';
import { resumePolishAgentOutputSchema, resumePolishSectionSchema } from '@jobhunter/resume';

/** Stable error body shared by Web route handlers and React clients. */
export const webErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type WebError = z.infer<typeof webErrorSchema>;

export type WebSuccessEnvelopeSchema<TSchema extends z.ZodType> = z.ZodObject<{
  data: TSchema;
  meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}>;

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

export const webErrorEnvelopeSchema = z
  .object({
    error: webErrorSchema,
  })
  .strict();

export interface WebSuccessEnvelope<TData> {
  readonly data: TData;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface WebErrorEnvelope {
  readonly error: WebError;
}

export const webTaskAcceptedSchema = z
  .object({
    taskId: z.uuid(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
    deduplicated: z.boolean(),
    statusUrl: z.string().startsWith('/api/tasks/'),
  })
  .strict();

export type WebTaskAccepted = z.infer<typeof webTaskAcceptedSchema>;

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

export type WebResumeImportResult = z.infer<typeof webResumeImportResultSchema>;

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
  })
  .strict();

export type WebDashboard = z.infer<typeof webDashboardSchema>;

export const webPaginationSchema = z
  .object({
    current: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type WebPagination = z.infer<typeof webPaginationSchema>;

export function webPagination(total: number, current: number, pageSize: number): WebPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return webPaginationSchema.parse({
    current: Math.min(Math.max(current, 1), totalPages),
    total,
    totalPages,
    pageSize,
  });
}

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

export type WebJobQuery = z.infer<typeof webJobQuerySchema>;

export const webJobMatchMutationSchema = z
  .object({
    profileVersionId: z.uuid().optional(),
    idempotencyToken: z.string().trim().min(8).max(200),
    mode: z.enum(['rules', 'llm']).default('rules'),
  })
  .strict();

export type WebJobMatchMutation = z.infer<typeof webJobMatchMutationSchema>;

export const webJobBulkMatchMutationSchema = webJobMatchMutationSchema
  .extend({ jobIds: z.array(z.uuid()).min(1).max(100) })
  .strict();

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

export type WebJobListItem = z.infer<typeof webJobListItemSchema>;

export const webJobPageSchema = z
  .object({
    items: z.array(webJobListItemSchema),
    page: webPaginationSchema,
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type WebJobPage = z.infer<typeof webJobPageSchema>;

export const webJobRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();

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

export type WebJobDetail = z.infer<typeof webJobDetailSchema>;

export const webProfileSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currentVersionId: z.uuid().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

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

export const webProfileDetailSchema = z
  .object({
    profile: webProfileSummarySchema,
    current: webProfileVersionSchema,
    versions: z.array(webProfileVersionSchema),
  })
  .strict();

export type WebProfileDetail = z.infer<typeof webProfileDetailSchema>;

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

export type WebProfileMutation = z.infer<typeof webProfileMutationSchema>;

export const webResumePolishRequestSchema = z
  .object({
    profileId: z.uuid(),
    sourceVersionId: z.uuid(),
    sections: z.array(resumePolishSectionSchema).min(1).max(2),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

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

export type WebResumePolishAccepted = z.infer<typeof webResumePolishAcceptedSchema>;

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

export type WebResumePolishStatus = z.infer<typeof webResumePolishStatusSchema>;

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

export type WebSource = z.infer<typeof webSourceSchema>;

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

export type WebSourceChannel = z.infer<typeof webSourceChannelSchema>;

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

export type WebSourceChannelMutation = z.infer<typeof webSourceChannelMutationSchema>;

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

export type WebSourceMutation = z.infer<typeof webSourceMutationSchema>;

export const webSettingsSchema = z
  .object({
    jobUnderstanding: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type WebSettings = z.infer<typeof webSettingsSchema>;

export const webSettingsMutationSchema = z
  .object({
    jobUnderstandingEnabled: z.boolean(),
  })
  .strict();

export type WebSettingsMutation = z.infer<typeof webSettingsMutationSchema>;

const webTaskStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);

export const webTaskSchema = z
  .object({
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
  })
  .strict();

export type WebTask = z.infer<typeof webTaskSchema>;

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

export type WebAgentRunSummary = z.infer<typeof webAgentRunSummarySchema>;
export type WebAgentRunDetail = z.infer<typeof webAgentRunDetailSchema>;

export const webDiagnosticsSchema = z
  .object({
    tasks: z.array(webTaskSchema),
    taskPagination: webPaginationSchema,
    agentRuns: z.array(webAgentRunSummarySchema),
    agentPagination: webPaginationSchema,
  })
  .strict();

export type WebDiagnostics = z.infer<typeof webDiagnosticsSchema>;

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

export type WebTaskMutation = z.infer<typeof webTaskMutationSchema>;

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
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

export type WebResumeDeletionImpact = z.infer<typeof webResumeDeletionImpactSchema>;

export const webResumeDeletionConfirmSchema = z
  .object({
    resumeDocumentId: z.uuid(),
    expectedImpactHash: z.string().length(64),
    confirmation: z.literal('DELETE'),
    idempotencyToken: z.string().trim().min(8).max(200),
  })
  .strict();

export type WebResumeDeletionConfirm = z.infer<typeof webResumeDeletionConfirmSchema>;
