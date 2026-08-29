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
    recruitmentType: text('recruitment_type').notNull(),
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
      'job_sources_recruitment_check',
      sql`${table.recruitmentType} in ('social', 'campus', 'mixed')`,
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

export const fileArtifacts = sqliteTable(
  'file_artifacts',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    relativePath: text('relative_path').notNull().unique(),
    mediaType: text('media_type').notNull(),
    sha256: text().notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: epoch('created_at').notNull(),
    deletedAt: epoch('deleted_at'),
  },
  (table) => [
    index('file_artifacts_sha256_idx').on(table.sha256),
    check(
      'file_artifacts_kind_check',
      sql`${table.kind} in ('raw_job', 'resume', 'export', 'fixture_candidate')`,
    ),
    check('file_artifacts_size_check', sql`${table.byteSize} >= 0`),
  ],
);

export const rawJobRecords = sqliteTable(
  'raw_job_records',
  {
    id: text().primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'restrict' }),
    firstSyncRunId: text('first_sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'restrict' }),
    externalJobId: text('external_job_id'),
    identityKey: text('identity_key').notNull(),
    sourceUrl: text('source_url').notNull(),
    contentHash: text('content_hash').notNull(),
    payloadJson: jsonText('payload_json'),
    artifactId: text('artifact_id').references(() => fileArtifacts.id, { onDelete: 'restrict' }),
    capturedAt: epoch('captured_at').notNull(),
  },
  (table) => [
    unique('raw_job_records_identity_content_unique').on(
      table.sourceId,
      table.identityKey,
      table.contentHash,
    ),
    check(
      'raw_job_records_payload_check',
      sql`${table.payloadJson} is not null or ${table.artifactId} is not null`,
    ),
  ],
);

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

export const syncItemFailures = sqliteTable(
  'sync_item_failures',
  {
    id: text().primaryKey(),
    syncRunId: text('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'cascade' }),
    externalJobId: text('external_job_id').notNull(),
    stage: text().notNull(),
    errorCategory: text('error_category').notNull(),
    errorSummary: text('error_summary').notNull(),
    rawRecordId: text('raw_record_id')
      .notNull()
      .references(() => rawJobRecords.id, { onDelete: 'restrict' }),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [index('sync_item_failures_run_idx').on(table.syncRunId, table.createdAt)],
);

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
    snapshotJson: jsonText('snapshot_json').notNull(),
    changeSetJson: jsonText('change_set_json').notNull(),
    rawRecordId: text('raw_record_id')
      .notNull()
      .references(() => rawJobRecords.id, { onDelete: 'restrict' }),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [
    unique('job_revisions_number_unique').on(table.jobId, table.revisionNo),
    unique('job_revisions_content_unique').on(table.jobId, table.contentHash),
    check('job_revisions_number_check', sql`${table.revisionNo} >= 1`),
  ],
);

export const jobObservations = sqliteTable(
  'job_observations',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    syncRunId: text('sync_run_id')
      .notNull()
      .references(() => syncRuns.id, { onDelete: 'restrict' }),
    rawRecordId: text('raw_record_id')
      .notNull()
      .references(() => rawJobRecords.id, { onDelete: 'restrict' }),
    observedAt: epoch('observed_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.syncRunId] })],
);

export const jobStatusEvents = sqliteTable(
  'job_status_events',
  {
    id: text().primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    syncRunId: text('sync_run_id').references(() => syncRuns.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reasonCode: text('reason_code').notNull(),
    evidenceJson: jsonText('evidence_json').notNull(),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [index('job_status_events_job_created_idx').on(table.jobId, table.createdAt)],
);

export const resumeDocuments = sqliteTable('resume_documents', {
  id: text().primaryKey(),
  artifactId: text('artifact_id')
    .notNull()
    .unique()
    .references(() => fileArtifacts.id, { onDelete: 'restrict' }),
  contentHash: text('content_hash').notNull().unique(),
  mediaType: text('media_type').notNull(),
  extractedText: text('extracted_text'),
  parseStatus: text('parse_status').notNull(),
  parserVersion: text('parser_version'),
  errorSummary: text('error_summary'),
  createdAt: epoch('created_at').notNull(),
});

export const candidateProfiles = sqliteTable('candidate_profiles', {
  id: text().primaryKey(),
  name: text().notNull(),
  createdAt: epoch('created_at').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

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

export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: text().primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    resumeDocumentId: text('resume_document_id').references(() => resumeDocuments.id, {
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

export const resumePolishSuggestions = sqliteTable(
  'resume_polish_suggestions',
  {
    id: text().primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    sourceVersionId: text('source_version_id')
      .notNull()
      .references(() => profileVersions.id, { onDelete: 'cascade' }),
    sectionsJson: jsonText('sections_json').notNull(),
    resultJson: jsonText('result_json').notNull(),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'restrict' }),
    createdAt: epoch('created_at').notNull(),
  },
  (table) => [index('resume_polish_suggestions_profile_idx').on(table.profileId, table.createdAt)],
);

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

export const agentToolCalls = sqliteTable(
  'agent_tool_calls',
  {
    id: text().primaryKey(),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    sequenceNo: integer('sequence_no').notNull(),
    toolKey: text('tool_key').notNull(),
    inputSummaryJson: jsonText('input_summary_json').notNull(),
    outputSummaryJson: jsonText('output_summary_json'),
    status: text().notNull(),
    durationMs: integer('duration_ms'),
    errorSummary: text('error_summary'),
  },
  (table) => [unique('agent_tool_calls_sequence_unique').on(table.agentRunId, table.sequenceNo)],
);

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

export const applicationSettings = sqliteTable('application_settings', {
  key: text().primaryKey(),
  valueJson: jsonText('value_json').notNull(),
  schemaVersion: text('schema_version').notNull(),
  updatedAt: epoch('updated_at').notNull(),
});

export const operationAuditEvents = sqliteTable('operation_audit_events', {
  eventKey: text('event_key').primaryKey(),
  eventType: text('event_type').notNull(),
  subjectHash: text('subject_hash').notNull(),
  detailsJson: jsonText('details_json').notNull(),
  createdAt: epoch('created_at').notNull(),
});

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

export const projectDossiers = sqliteTable(
  'project_dossiers',
  {
    id: text().primaryKey(),
    snapshotId: text('snapshot_id')
      .notNull()
      .unique()
      .references(() => resumeProjectSnapshots.id, { onDelete: 'restrict' }),
    latestNotebookArtifactId: text('latest_notebook_artifact_id').references(
      () => fileArtifacts.id,
      { onDelete: 'restrict' },
    ),
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
    status: text().notNull(),
    contextRevision: integer('context_revision').notNull().default(0),
    createdAt: epoch('created_at').notNull(),
    updatedAt: epoch('updated_at').notNull(),
    completedAt: epoch('completed_at'),
  },
  (table) => [
    uniqueIndex('drill_sessions_one_open_per_dossier_idx')
      .on(table.dossierId)
      .where(sql`${table.status} in ('active', 'paused')`),
    check('drill_sessions_profile_key_check', sql`${table.profileKey} = 'resume-only'`),
    check('drill_sessions_profile_version_check', sql`${table.profileVersion} = 'v1'`),
    check(
      'drill_sessions_status_check',
      sql`${table.status} in ('active', 'paused', 'completed')`,
    ),
    check('drill_sessions_revision_check', sql`${table.contextRevision} >= 0`),
  ],
);

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
    check(
      'project_knowledge_items_status_check',
      sql`${table.status} in ('active', 'superseded')`,
    ),
    check('project_knowledge_items_start_check', sql`${table.sourceStart} >= 0`),
    check('project_knowledge_items_end_check', sql`${table.sourceEnd} > ${table.sourceStart}`),
  ],
);

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
