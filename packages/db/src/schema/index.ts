import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  type SQLiteIntegerBuilderInitial,
  type SQLiteTextBuilderInitial,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const jsonText = <TName extends string>(
  name: TName,
): SQLiteTextBuilderInitial<TName, [string, ...string[]], undefined> => text(name);
const epoch = <TName extends string>(name: TName): SQLiteIntegerBuilderInitial<TName> =>
  integer(name);

/** 公司主数据及别名、规模和启用状态。 */
export const companies = sqliteTable(
  'companies',
  {
    id: text().primaryKey(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    aliasesJson: jsonText('aliases_json').notNull().default('[]'),
    industry: text(),
    sizeTag: text('size_tag'),
    enabled: integer().notNull(),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [check('companies_enabled_check', sql`${table.enabled} in (0, 1)`)],
);

/** 公司下的招聘来源渠道。 */
export const sourceChannels = sqliteTable(
  'source_channels',
  {
    id: text().primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    channel: text().notNull(),
    slug: text().notNull().unique(),
    enabled: integer().notNull(),
    supportNote: text('support_note'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    unique('source_channels_company_channel_unique').on(table.companyId, table.channel),
    check('source_channels_channel_check', sql`${table.channel} in ('intern', 'campus', 'social')`),
    check('source_channels_enabled_check', sql`${table.enabled} in (0, 1)`),
  ],
);

/** 可执行同步的职位来源及其健康、策略配置。 */
export const jobSources = sqliteTable(
  'job_sources',
  {
    id: text().primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => sourceChannels.id, { onDelete: 'restrict' }),
    slug: text().notNull().unique(),
    adapterKey: text('adapter_key').notNull().unique(),
    coverageRole: text('coverage_role').notNull().default('required'),
    baseUrl: text('base_url').notNull(),
    configJson: jsonText('config_json').notNull().default('{}'),
    syncPolicyVersion: text('sync_policy_version').notNull(),
    syncPolicyJson: jsonText('sync_policy_json').notNull(),
    enabled: integer().notNull(),
    supportStatus: text('support_status').notNull(),
    supportNote: text('support_note'),
    healthStatus: text('health_status').notNull(),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    probeStatus: text('probe_status'),
    lastProbeAt: epoch('last_probe_at'),
    probeErrorCategory: text('probe_error_category'),
    probeDiagnosticsJson: jsonText('probe_diagnostics_json').notNull().default('{}'),
    lastSuccessAt: epoch('last_success_at'),
    lastFailureAt: epoch('last_failure_at'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    check('job_sources_enabled_check', sql`${table.enabled} in (0, 1)`),
    check(
      'job_sources_coverage_role_check',
      sql`${table.coverageRole} in ('required', 'supplemental')`,
    ),
    check(
      'job_sources_support_check',
      sql`${table.supportStatus} in ('experimental', 'supported', 'blocked')`,
    ),
    check(
      'job_sources_health_check',
      sql`${table.healthStatus} in ('unknown', 'healthy', 'degraded', 'unhealthy')`,
    ),
  ],
);

/** 一次职位来源同步运行及覆盖统计。 */
export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text().primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'restrict' }),
    trigger: text().notNull(),
    status: text().notNull(),
    coverage: text().notNull(),
    adapterVersion: text('adapter_version').notNull(),
    normalizerVersion: text('normalizer_version').notNull(),
    syncPolicyVersion: text('sync_policy_version').notNull(),
    sourceConfigHash: text('source_config_hash').notNull(),
    cursorInJson: jsonText('cursor_in_json'),
    cursorOutJson: jsonText('cursor_out_json'),
    statsJson: jsonText('stats_json').notNull().default('{}'),
    coverageEvidenceJson: jsonText('coverage_evidence_json').notNull().default('{}'),
    errorCategory: text('error_category'),
    errorSummary: text('error_summary'),
    startedAt: epoch('started_at').notNull(),
    finishedAt: epoch('finished_at'),
  },
  (table) => [
    index('sync_runs_source_started_idx').on(table.sourceId, table.startedAt),
    index('sync_runs_status_started_idx').on(table.status, table.startedAt),
    uniqueIndex('sync_runs_one_running_per_source_idx')
      .on(table.sourceId)
      .where(sql`${table.status} = 'running'`),
    check(
      'sync_runs_status_check',
      sql`${table.status} in ('running', 'succeeded', 'partial', 'failed', 'cancelled')`,
    ),
    check('sync_runs_coverage_check', sql`${table.coverage} in ('complete', 'partial', 'unknown')`),
  ],
);

/** 物理文件实体，记录存储路径、媒体类型和字节哈希。 */
export const files = sqliteTable(
  'files',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    name: text().notNull(),
    state: text().notNull(),
    revision: integer().notNull().default(0),
    propertiesJson: jsonText('properties_json').notNull().default('{}'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    index('files_kind_updated_idx').on(table.kind, table.updatedAt),
    uniqueIndex('files_project_material_dossier_name_idx')
      .on(
        sql`json_extract(${table.propertiesJson}, '$.dossierId')`,
        sql`json_extract(${table.propertiesJson}, '$.fileName')`,
      )
      .where(
        sql`${table.kind} = 'project_material'
            AND json_valid(${table.propertiesJson})
            AND json_type(${table.propertiesJson}, '$.dossierId') = 'text'
            AND json_type(${table.propertiesJson}, '$.fileName') = 'text'`,
      ),
    check('files_name_check', sql`length(trim(${table.name})) > 0`),
    check('files_revision_check', sql`${table.revision} >= 0`),
  ],
);

/** 逻辑文件实体，跨版本承载简历、面经等业务文件。 */
export const entities = sqliteTable(
  'entities',
  {
    id: text().primaryKey(),
    relativePath: text('relative_path').notNull().unique(),
    mediaType: text('media_type').notNull(),
    sha256: text().notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: epoch('created_at').notNull(),
    deletedAt: epoch('deleted_at'),
  },
  (table) => [
    uniqueIndex('entities_active_sha256_idx')
      .on(table.sha256)
      .where(sql`${table.deletedAt} is null`),
    check('entities_hash_check', sql`length(${table.sha256}) = 64`),
    check('entities_size_check', sql`${table.byteSize} >= 0`),
  ],
);

/** 逻辑实体到物理文件版本的映射，限制每个实体最多五个版本。 */
export const fileEntityMappings = sqliteTable(
  'file_entity_mappings',
  {
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    versionNo: integer('version_no').notNull(),
    parserVersion: text('parser_version'),
    parseStatus: text('parse_status'),
    extractedText: text('extracted_text'),
    normalizedText: text('normalized_text'),
    errorSummary: text('error_summary'),
    metadataJson: jsonText('metadata_json').notNull().default('{}'),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fileId, table.versionNo] }),
    unique('file_entity_mappings_file_entity_unique').on(table.fileId, table.entityId),
    index('file_entity_mappings_entity_idx').on(table.entityId, table.fileId),
    check('file_entity_mappings_number_check', sql`${table.versionNo} between 1 and 5`),
  ],
);

/** 来源页面与规范职位之间的关联详情。 */
export const sourceJobDetails = sqliteTable(
  'source_job_details',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'cascade' }),
    externalJobId: text('external_job_id').notNull(),
    listContentHash: text('list_content_hash').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    status: text().notNull(),
    detailJson: jsonText('detail_json'),
    errorCategory: text('error_category'),
    errorSummary: text('error_summary'),
    fetchedAt: epoch('fetched_at'),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.externalJobId] }),
    check('source_job_details_status_check', sql`${table.status} in ('succeeded', 'failed')`),
  ],
);

/** 通用领域事件，记录聚合状态变化和可追溯载荷。 */
export const events = sqliteTable(
  'events',
  {
    id: text().primaryKey(),
    streamType: text('stream_type').notNull(),
    streamId: text('stream_id').notNull(),
    sequenceNo: integer('sequence_no').notNull(),
    eventType: text('event_type').notNull(),
    payloadJson: jsonText('payload_json').notNull().default('{}'),
    occurredAt: epoch('occurred_at').notNull(),
  },
  (table) => [
    unique('events_stream_sequence_unique').on(table.streamType, table.streamId, table.sequenceNo),
    index('events_stream_occurred_idx').on(table.streamType, table.streamId, table.occurredAt),
    index('events_type_occurred_idx').on(table.eventType, table.occurredAt),
    check('events_sequence_check', sql`${table.sequenceNo} >= 1`),
  ],
);

/** 规范化职位主表，保存跨来源合并后的当前状态。 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text().primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'restrict' }),
    externalJobId: text('external_job_id').notNull(),
    title: text().notNull(),
    department: text(),
    jobFamily: text('job_family'),
    jobSubfamily: text('job_subfamily'),
    locationsJson: jsonText('locations_json').notNull().default('[]'),
    employmentType: text('employment_type'),
    recruitmentCategory: text('recruitment_category'),
    experienceText: text('experience_text'),
    educationText: text('education_text'),
    description: text().notNull(),
    detailUrl: text('detail_url').notNull(),
    applyUrl: text('apply_url').notNull(),
    publishedAt: epoch('published_at'),
    status: text().notNull(),
    missingCount: integer('missing_count').notNull().default(0),
    contentHash: text('content_hash').notNull(),
    firstSeenAt: epoch('first_seen_at').notNull(),
    lastSeenAt: epoch('last_seen_at').notNull(),
    closedAt: epoch('closed_at'),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    unique('jobs_source_external_unique').on(table.sourceId, table.externalJobId),
    index('jobs_status_updated_idx').on(table.status, table.updatedAt),
    index('jobs_company_status_updated_idx').on(table.companyId, table.status, table.updatedAt),
    index('jobs_family_status_idx').on(table.jobFamily, table.status),
    index('jobs_published_idx').on(table.publishedAt),
    check('jobs_status_check', sql`${table.status} in ('active', 'stale', 'closed')`),
    check('jobs_missing_count_check', sql`${table.missingCount} >= 0`),
  ],
);

/** 职位主表的历史修订快照。 */
export const jobRevisions = sqliteTable(
  'job_revisions',
  {
    id: text().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    contentHash: text('content_hash').notNull(),
    normalizerVersion: text('normalizer_version').notNull(),
    sourcePayloadHash: text('source_payload_hash').notNull(),
    sourceUrl: text('source_url').notNull(),
    snapshotJson: jsonText('snapshot_json').notNull(),
    changeSetJson: jsonText('change_set_json').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique('job_revisions_number_unique').on(table.jobId, table.revisionNo),
    unique('job_revisions_content_unique').on(table.jobId, table.contentHash),
    check('job_revisions_number_check', sql`${table.revisionNo} >= 1`),
    check('job_revisions_source_hash_check', sql`length(${table.sourcePayloadHash}) = 64`),
  ],
);

/** 来源对职位字段的观测记录，用于变化检测。 */
export const jobObservations = sqliteTable(
  'job_observations',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    syncRunId: text('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'restrict' }),
    jobRevisionId: text('job_revision_id')
      .notNull()
      .references(() => jobRevisions.id, { onDelete: 'restrict' }),
    observedAt: epoch('observed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.syncRunId] }),
    index('job_observations_revision_idx').on(table.jobRevisionId, table.observedAt),
  ],
);

/** 求职者简历档案的逻辑主记录。 */
export const candidateProfiles = sqliteTable('candidate_profiles', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

/** Agent 执行记录、输入输出摘要和成本状态。 */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text().primaryKey(),
    agentKey: text('agent_key').notNull(),
    agentVersion: text('agent_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    modelConfigHash: text('model_config_hash').notNull(),
    inputHash: text('input_hash').notNull(),
    cacheKey: text('cache_key').notNull(),
    status: text().notNull(),
    outputJson: jsonText('output_json'),
    errorCategory: text('error_category'),
    errorSummary: text('error_summary'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCostMicros: integer('estimated_cost_micros'),
    costCurrency: text('cost_currency'),
    pricingVersion: text('pricing_version'),
    startedAt: epoch('started_at').notNull(),
    finishedAt: epoch('finished_at'),
  },
  (table) => [
    uniqueIndex('agent_runs_success_cache_idx')
      .on(table.cacheKey)
      .where(sql`${table.status} = 'succeeded'`),
  ],
);

/** 简历档案的版本记录及解析来源。 */
export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: text().primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    resumeDocumentId: text('resume_file_id').references(() => files.id, {
      onDelete: 'restrict',
    }),
    agentRunId: text('agent_run_id').references(() => agentRuns.id, { onDelete: 'restrict' }),
    extractedJson: jsonText('extracted_json').notNull(),
    effectiveJson: jsonText('effective_json').notNull(),
    lockedPathsJson: jsonText('locked_paths_json').notNull().default('[]'),
    contentHash: text('content_hash').notNull(),
    isCurrent: integer('is_current').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique('profile_versions_number_unique').on(table.profileId, table.versionNo),
    uniqueIndex('profile_versions_one_current_idx')
      .on(table.profileId)
      .where(sql`${table.isCurrent} = 1`),
  ],
);

/** 职位补充分析结果及其 Agent 版本。 */
export const jobEnrichments = sqliteTable(
  'job_enrichments',
  {
    id: text().primaryKey(),
    jobRevisionId: text('job_revision_id')
      .notNull()
      .references(() => jobRevisions.id, { onDelete: 'restrict' }),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'restrict' }),
    schemaVersion: text('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    resultJson: jsonText('result_json').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [unique('job_enrichments_run_unique').on(table.jobRevisionId, table.agentRunId)],
);

/** 职位匹配规则集及其版本哈希。 */
export const matchRulesets = sqliteTable(
  'match_rulesets',
  {
    id: text().primaryKey(),
    version: text().notNull().unique(),
    definitionJson: jsonText('definition_json').notNull(),
    definitionHash: text('definition_hash').notNull().unique(),
    active: integer().notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('match_rulesets_one_active_idx')
      .on(table.active)
      .where(sql`${table.active} = 1`),
  ],
);

/** 简历版本与职位之间的匹配结果。 */
export const matchResults = sqliteTable(
  'match_results',
  {
    id: text().primaryKey(),
    profileVersionId: text('profile_version_id')
      .notNull()
      .references(() => profileVersions.id, { onDelete: 'restrict' }),
    jobRevisionId: text('job_revision_id')
      .notNull()
      .references(() => jobRevisions.id, { onDelete: 'restrict' }),
    jobEnrichmentId: text('job_enrichment_id').references(() => jobEnrichments.id, {
      onDelete: 'restrict',
    }),
    rulesetId: text('ruleset_id')
      .notNull()
      .references(() => matchRulesets.id, { onDelete: 'restrict' }),
    filterStatus: text('filter_status').notNull(),
    totalScore: real('total_score').notNull(),
    componentsJson: jsonText('components_json').notNull(),
    risksJson: jsonText('risks_json').notNull(),
    inputHash: text('input_hash').notNull().unique(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    index('match_results_inputs_idx').on(
      table.profileVersionId,
      table.jobRevisionId,
      table.rulesetId,
    ),
    index('match_results_profile_rank_idx').on(
      table.profileVersionId,
      table.filterStatus,
      table.totalScore,
    ),
  ],
);

/** 针对匹配结果生成的准备建议。 */
export const matchAdvices = sqliteTable(
  'match_advices',
  {
    id: text().primaryKey(),
    matchResultId: text('match_result_id')
      .notNull()
      .references(() => matchResults.id, { onDelete: 'cascade' }),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'restrict' }),
    schemaVersion: text('schema_version').notNull(),
    contentHash: text('content_hash').notNull(),
    resultJson: jsonText('result_json').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [unique('match_advices_run_unique').on(table.matchResultId, table.agentRunId)],
);

/** 通用周期调度定义及其运行游标。 */
export const schedules = sqliteTable('schedules', {
  id: text().primaryKey(),
  scheduleKey: text('schedule_key').notNull().unique(),
  taskType: text('task_type').notNull(),
  payloadJson: jsonText('payload_json').notNull(),
  cronExpression: text('cron_expression').notNull(),
  timezone: text().notNull(),
  enabled: integer().notNull(),
  nextRunAt: epoch('next_run_at').notNull(),
  lastEnqueuedAt: epoch('last_enqueued_at'),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

/** 通用异步任务队列，承载可重试的后台工作。 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text().primaryKey(),
    taskType: text('task_type').notNull(),
    payloadJson: jsonText('payload_json').notNull(),
    status: text().notNull(),
    priority: integer().notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    concurrencyKey: text('concurrency_key'),
    scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'restrict' }),
    retryOfTaskId: text('retry_of_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'restrict',
    }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    availableAt: epoch('available_at').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: epoch('lease_expires_at'),
    lastHeartbeatAt: epoch('last_heartbeat_at'),
    cancelRequestedAt: epoch('cancel_requested_at'),
    errorCategory: text('error_category'),
    errorSummary: text('error_summary'),
    resultJson: jsonText('result_json'),
    createdAt: epoch('created_at').notNull(),
    startedAt: epoch('started_at'),
    finishedAt: epoch('finished_at'),
  },
  (table) => [
    index('tasks_claim_idx').on(
      table.taskType,
      table.status,
      table.availableAt,
      table.priority,
      table.createdAt,
    ),
    index('tasks_recovery_idx').on(table.status, table.leaseExpiresAt),
    uniqueIndex('tasks_active_concurrency_idx')
      .on(table.concurrencyKey)
      .where(
        sql`${table.concurrencyKey} is not null and ${table.status} in ('pending', 'running')`,
      ),
  ],
);

/** 本地应用设置键值。 */
export const applicationSettings = sqliteTable('application_settings', {
  key: text().primaryKey(),
  valueJson: jsonText('value_json').notNull(),
  schemaVersion: text('schema_version').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

/** 从简历冻结的项目快照，作为项目拷打事实边界。 */
export const resumeProjectSnapshots = sqliteTable(
  'resume_project_snapshots',
  {
    id: text().primaryKey(),
    sourceProfileId: text('source_profile_id').notNull(),
    sourceProfileVersionId: text('source_profile_version_id').notNull(),
    projectIndex: integer('project_index').notNull(),
    projectJson: jsonText('project_json').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique('resume_project_snapshots_source_unique').on(
      table.sourceProfileVersionId,
      table.projectIndex,
      table.contentHash,
    ),
    check('resume_project_snapshots_index_check', sql`${table.projectIndex} >= 0`),
  ],
);

/** 项目拷打档案及其最新备忘录引用。 */
export const projectDossiers = sqliteTable(
  'project_dossiers',
  {
    id: text().primaryKey(),
    snapshotId: text('snapshot_id')
      .notNull()
      .unique()
      .references(() => resumeProjectSnapshots.id, { onDelete: 'restrict' }),
    latestNotebookArtifactId: text('notebook_file_id').references(() => files.id, {
      onDelete: 'restrict',
    }),
    notebookSourceHash: text('notebook_source_hash'),
    revision: integer().notNull().default(0),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    index('project_dossiers_updated_idx').on(table.updatedAt),
    check('project_dossiers_revision_check', sql`${table.revision} >= 0`),
  ],
);

/** 项目拷打会话，冻结档位和资料版本。 */
export const drillSessions = sqliteTable(
  'drill_sessions',
  {
    id: text().primaryKey(),
    dossierId: text('dossier_id')
      .notNull()
      .references(() => projectDossiers.id, { onDelete: 'cascade' }),
    profileKey: text('profile_key').notNull(),
    profileVersion: text('profile_version').notNull(),
    profileDefinitionHash: text('profile_definition_hash').notNull(),
    capabilitySummaryJson: jsonText('capability_summary_json').notNull(),
    materialBindingsJson: jsonText('material_bindings_json').notNull().default('[]'),
    status: text().notNull(),
    contextRevision: integer('context_revision').notNull().default(0),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
    completedAt: epoch('completed_at'),
  },
  (table) => [
    uniqueIndex('drill_sessions_one_active_per_dossier_idx')
      .on(table.dossierId)
      .where(sql`${table.status} = 'active'`),
    check(
      'drill_sessions_profile_key_check',
      sql`${table.profileKey} in ('resume-only', 'docs-grounded')`,
    ),
    check('drill_sessions_profile_version_check', sql`${table.profileVersion} = 'v1'`),
    check('drill_sessions_status_check', sql`${table.status} in ('active', 'paused', 'completed')`),
    check('drill_sessions_revision_check', sql`${table.contextRevision} >= 0`),
    check(
      'drill_sessions_material_bindings_check',
      sql`json_valid(${table.materialBindingsJson}) and json_type(${table.materialBindingsJson}) = 'array' and ((${table.profileKey} = 'resume-only' and json_array_length(${table.materialBindingsJson}) = 0) or (${table.profileKey} = 'docs-grounded' and json_array_length(${table.materialBindingsJson}) between 1 and 8))`,
    ),
  ],
);

/** 网友面经研究请求及其外部执行状态。 */
export const experienceResearchRequests = sqliteTable(
  'experience_research_requests',
  {
    id: text().primaryKey(),
    briefJson: jsonText('brief_json').notNull(),
    requestFingerprint: text('request_fingerprint').notNull().unique(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    promptFileId: text('prompt_file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    promptFileVersionNo: integer('prompt_file_version_no').notNull(),
    schemaFileId: text('schema_file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    schemaFileVersionNo: integer('schema_file_version_no').notNull(),
    bundleFileId: text('bundle_file_id').references(() => files.id, { onDelete: 'restrict' }),
    bundleFileVersionNo: integer('bundle_file_version_no'),
    bundleImportToken: text('bundle_import_token'),
    bundleImportClaimedAt: epoch('bundle_import_claimed_at'),
    bundleImportFileId: text('bundle_import_file_id'),
    currentTaskId: text('current_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    state: text().notNull(),
    revision: integer().notNull().default(0),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    index('experience_research_requests_state_updated_idx').on(table.state, table.updatedAt),
    check('experience_research_requests_brief_check', sql`json_valid(${table.briefJson})`),
    check(
      'experience_research_requests_fingerprint_check',
      sql`length(${table.requestFingerprint}) = 64`,
    ),
    check(
      'experience_research_requests_state_check',
      sql`${table.state} in ('ready', 'needs_review', 'completed')`,
    ),
    check(
      'experience_research_requests_prompt_version_no_check',
      sql`${table.promptFileVersionNo} between 1 and 5`,
    ),
    check(
      'experience_research_requests_schema_version_no_check',
      sql`${table.schemaFileVersionNo} between 1 and 5`,
    ),
    check('experience_research_requests_revision_check', sql`${table.revision} >= 0`),
    check(
      'experience_research_requests_bundle_check',
      sql`((${table.bundleFileId} is null and ${table.bundleFileVersionNo} is null) or (${table.bundleFileId} is not null and ${table.bundleFileVersionNo} between 1 and 5))`,
    ),
    check(
      'experience_research_requests_bundle_claim_check',
      sql`((${table.bundleImportToken} is null and ${table.bundleImportClaimedAt} is null and ${table.bundleImportFileId} is null) or (${table.bundleImportToken} is not null and length(trim(${table.bundleImportToken})) > 0 and ${table.bundleImportClaimedAt} >= 0 and ${table.bundleImportFileId} is not null and length(trim(${table.bundleImportFileId})) > 0))`,
    ),
  ],
);

/** 拷打会话中的逐题状态和 Agent 任务引用。 */
export const drillTurns = sqliteTable(
  'drill_turns',
  {
    id: text().primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => drillSessions.id, { onDelete: 'cascade' }),
    turnNo: integer('turn_no').notNull(),
    status: text().notNull(),
    contextHash: text('context_hash').notNull(),
    question: text(),
    intent: text(),
    primaryDimension: text('primary_dimension'),
    guidanceSlotsJson: jsonText('guidance_slots_json').notNull().default('[]'),
    evidenceRefsJson: jsonText('evidence_refs_json').notNull().default('[]'),
    questionTaskId: text('question_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    questionAgentRunId: text('question_agent_run_id').references(() => agentRuns.id, {
      onDelete: 'restrict',
    }),
    digestTaskId: text('digest_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    digestAgentRunId: text('digest_agent_run_id').references(() => agentRuns.id, {
      onDelete: 'restrict',
    }),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    unique('drill_turns_session_number_unique').on(table.sessionId, table.turnNo),
    index('drill_turns_session_status_idx').on(table.sessionId, table.status, table.turnNo),
    check('drill_turns_number_check', sql`${table.turnNo} >= 1`),
    check(
      'drill_turns_status_check',
      sql`${table.status} in ('question_pending', 'awaiting_answer', 'digest_pending', 'ready', 'skipped', 'cancelled')`,
    ),
  ],
);

/** 用户对拷打问题提交的回答修订。 */
export const drillAnswerRevisions = sqliteTable(
  'drill_answer_revisions',
  {
    id: text().primaryKey(),
    turnId: text('turn_id')
      .notNull()
      .references(() => drillTurns.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    answerText: text('answer_text').notNull(),
    contentHash: text('content_hash').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique('drill_answer_revisions_number_unique').on(table.turnId, table.revisionNo),
    unique('drill_answer_revisions_idempotency_unique').on(table.turnId, table.idempotencyKey),
    check('drill_answer_revisions_number_check', sql`${table.revisionNo} >= 1`),
  ],
);

/** 从回答中抽取的可追溯项目知识项。 */
export const projectKnowledgeItems = sqliteTable(
  'project_knowledge_items',
  {
    id: text().primaryKey(),
    dossierId: text('dossier_id')
      .notNull()
      .references(() => projectDossiers.id, { onDelete: 'cascade' }),
    sourceAnswerRevisionId: text('source_answer_revision_id')
      .notNull()
      .references(() => drillAnswerRevisions.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    statement: text().notNull(),
    quote: text().notNull(),
    sourceStart: integer('source_start').notNull(),
    sourceEnd: integer('source_end').notNull(),
    status: text().notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    index('project_knowledge_items_dossier_status_idx').on(
      table.dossierId,
      table.status,
      table.createdAt,
    ),
    check(
      'project_knowledge_items_kind_check',
      sql`${table.kind} in ('fact', 'decision', 'metric', 'incident', 'lesson', 'ambiguity', 'conflict')`,
    ),
    check('project_knowledge_items_status_check', sql`${table.status} in ('active', 'superseded')`),
    check('project_knowledge_items_start_check', sql`${table.sourceStart} >= 0`),
    check('project_knowledge_items_end_check', sql`${table.sourceEnd} > ${table.sourceStart}`),
  ],
);

/** 项目拷打维度的覆盖和澄清状态。 */
export const drillCoverage = sqliteTable(
  'drill_coverage',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => drillSessions.id, { onDelete: 'cascade' }),
    dimension: text().notNull(),
    status: text().notNull(),
    evidenceItemIdsJson: jsonText('evidence_item_ids_json').notNull().default('[]'),
    updatedAt: epoch('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.dimension] }),
    check(
      'drill_coverage_dimension_check',
      sql`${table.dimension} in ('background_goal', 'personal_responsibility', 'architecture_design', 'key_implementation', 'technical_tradeoff', 'data_metrics', 'incident_debugging', 'collaboration_delivery', 'security_quality', 'reflection_evolution')`,
    ),
    check(
      'drill_coverage_status_check',
      sql`${table.status} in ('unasked', 'asked', 'evidence_partial', 'evidence_sufficient', 'needs_clarification')`,
    ),
  ],
);

/** 个人或网友面经中的一次面试经历。 */
export const interviewExperiences = sqliteTable(
  'interview_experiences',
  {
    id: text().primaryKey(),
    documentId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    sequenceNo: integer('sequence_no').notNull(),
    sourceType: text('source_type').notNull().default('personal'),
    reviewStatus: text('review_status').notNull().default('draft'),
    researchRequestId: text('research_request_id').references(() => experienceResearchRequests.id, {
      onDelete: 'cascade',
    }),
    company: text(),
    role: text(),
    stage: text(),
    occurredOn: text('occurred_on'),
    outcome: text(),
    difficulty: text(),
    tagsJson: jsonText('tags_json').notNull().default('[]'),
    notes: text(),
    sourceUrl: text('source_url'),
    sourceTitle: text('source_title'),
    sourcePublishedAt: text('source_published_at'),
    sourceRetrievedAt: text('source_retrieved_at'),
    verificationStatus: text('verification_status').notNull().default('not_applicable'),
  },
  (table) => [
    unique('interview_experiences_document_sequence_unique').on(table.documentId, table.sequenceNo),
    index('interview_experiences_company_role_idx').on(table.company, table.role, table.occurredOn),
    index('interview_experiences_research_review_idx').on(
      table.researchRequestId,
      table.reviewStatus,
      table.sequenceNo,
    ),
    check('interview_experiences_sequence_check', sql`${table.sequenceNo} >= 1`),
    check(
      'interview_experiences_source_type_check',
      sql`${table.sourceType} in ('personal', 'community')`,
    ),
    check(
      'interview_experiences_review_status_check',
      sql`${table.reviewStatus} in ('draft', 'needs_review', 'accepted', 'rejected')`,
    ),
    check(
      'interview_experiences_verification_check',
      sql`${table.verificationStatus} in ('not_applicable', 'unverified', 'verified')`,
    ),
    check(
      'interview_experiences_source_check',
      sql`(${table.sourceType} = 'personal' and ${table.researchRequestId} is null and ${table.verificationStatus} = 'not_applicable') or (${table.sourceType} = 'community' and ${table.researchRequestId} is not null and ${table.sourceUrl} is not null and ${table.sourceTitle} is not null and ${table.sourceRetrievedAt} is not null and ${table.verificationStatus} <> 'not_applicable')`,
    ),
  ],
);

/** 面试经历中的问题、回答内容和原始文档范围。 */
export const interviewQuestionEntries = sqliteTable(
  'interview_question_entries',
  {
    id: text().primaryKey(),
    experienceId: text('experience_id')
      .notNull()
      .references(() => interviewExperiences.id, { onDelete: 'cascade' }),
    sequenceNo: integer('sequence_no').notNull(),
    question: text().notNull(),
    answer: text(),
    reflection: text(),
    answerExcerpt: text('answer_excerpt'),
    topicsJson: jsonText('topics_json').notNull().default('[]'),
    questionFingerprint: text('question_fingerprint'),
    questionSourceStart: integer('question_source_start'),
    questionSourceEnd: integer('question_source_end'),
    answerSourceStart: integer('answer_source_start'),
    answerSourceEnd: integer('answer_source_end'),
  },
  (table) => [
    unique('interview_question_entries_experience_sequence_unique').on(
      table.experienceId,
      table.sequenceNo,
    ),
    index('interview_question_entries_experience_idx').on(table.experienceId, table.sequenceNo),
    index('interview_question_entries_fingerprint_idx').on(
      table.questionFingerprint,
      table.experienceId,
    ),
    check('interview_question_entries_sequence_check', sql`${table.sequenceNo} >= 1`),
    check('interview_question_entries_question_check', sql`length(trim(${table.question})) > 0`),
    check(
      'interview_question_entries_question_range_check',
      sql`(${table.questionSourceStart} is null and ${table.questionSourceEnd} is null) or (${table.questionSourceStart} >= 0 and ${table.questionSourceEnd} > ${table.questionSourceStart})`,
    ),
    check(
      'interview_question_entries_answer_range_check',
      sql`(${table.answerSourceStart} is null and ${table.answerSourceEnd} is null) or (${table.answerSourceStart} >= 0 and ${table.answerSourceEnd} > ${table.answerSourceStart})`,
    ),
    check(
      'interview_question_entries_fingerprint_check',
      sql`${table.questionFingerprint} is null or length(${table.questionFingerprint}) = 64`,
    ),
  ],
);

/** 同步运行中已见职位键，用于识别下架或消失记录。 */
export const syncSeenJobs = sqliteTable(
  'sync_seen_jobs',
  {
    syncRunId: text('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.syncRunId, table.jobId] })],
);
