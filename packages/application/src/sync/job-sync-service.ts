import {
  canonicalJson,
  contentHash,
  decideExplicitClosure,
  decideJobMerge,
  decideMissingTransition,
  decideObservedTransition,
  canonicalizeJobTaxonomy,
  parseId,
  type Clock,
  type IdGenerator,
  type JobSourceId,
  type SyncRunId,
  type UtcInstant,
} from '@jobhunter/domain';
import {
  canonicalizeOfficialUrl,
  discoveredJobSchema,
  isSourceError,
  SourceError,
  type AdapterRegistry,
  type DiscoveredJob,
  type DiscoveryEvent,
  type SourceHttpClient,
  type NormalizedSourceJob,
  type SourcePageClient,
} from '@jobhunter/source-core';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { SyncCoverage, SyncRunStats, SyncSourceRecord, SyncTrigger } from './model.js';
import type { JobIntakePolicy } from './job-intake-policy.js';
import { classifyJobRegion } from './region-policy.js';

interface MutableSyncRunStats {
  discovered: number;
  rawStored: number;
  created: number;
  unchanged: number;
  revised: number;
  restored: number;
  staled: number;
  closed: number;
  isolated: number;
  skippedNonDomestic: number;
  skippedUnknownRegion: number;
  skippedOutOfScope: number;
  followupEnqueued: number;
}

export type JobSyncResult =
  | { readonly kind: 'conflict'; readonly runId: SyncRunId }
  | {
      readonly kind: 'completed';
      readonly runId: SyncRunId;
      readonly status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
      readonly coverage: SyncCoverage;
      readonly stats: SyncRunStats;
      readonly errorCategory: string | null;
      readonly errorSummary: string | null;
    };

export interface JobSyncServiceOptions {
  readonly normalizerVersion: string;
  readonly maximumInlineRawBytes?: number;
  readonly unseenBatchSize?: number;
}

interface PreparedRaw {
  readonly contentHash: string;
  readonly payload: unknown;
  readonly artifactId: string | null;
}

const SENSITIVE_KEY = /authorization|cookie|token|password|api[-_]?key|secret/i;

function sanitizeRaw(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (depth > 20) return '[depth-limited]';
  if (Array.isArray(value)) return value.map((item) => sanitizeRaw(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeRaw(childValue, childKey, depth + 1),
      ]),
    );
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  return `[unsupported:${typeof value}]`;
}

function emptyStats(): MutableSyncRunStats {
  return {
    discovered: 0,
    rawStored: 0,
    created: 0,
    unchanged: 0,
    revised: 0,
    restored: 0,
    staled: 0,
    closed: 0,
    isolated: 0,
    skippedNonDomestic: 0,
    skippedUnknownRegion: 0,
    skippedOutOfScope: 0,
    followupEnqueued: 0,
  };
}

function immutableStats(stats: MutableSyncRunStats): SyncRunStats {
  return { ...stats };
}

function assertStats(stats: MutableSyncRunStats): void {
  const outcomes =
    stats.created +
    stats.unchanged +
    stats.revised +
    stats.isolated +
    stats.skippedNonDomestic +
    stats.skippedUnknownRegion +
    stats.skippedOutOfScope;
  if (outcomes !== stats.discovered || Object.values(stats).some((value) => value < 0)) {
    throw new Error('Sync statistics invariant failed.');
  }
}

export class JobSyncService {
  readonly #uow: UnitOfWork;
  readonly #registry: AdapterRegistry;
  readonly #artifacts: ArtifactStore;
  readonly #http: SourceHttpClient;
  readonly #page: SourcePageClient | undefined;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #normalizerVersion: string;
  readonly #maximumInlineRawBytes: number;
  readonly #unseenBatchSize: number;
  readonly #jobIntakePolicy: JobIntakePolicy | undefined;

  public constructor(input: {
    readonly uow: UnitOfWork;
    readonly registry: AdapterRegistry;
    readonly artifacts: ArtifactStore;
    readonly http: SourceHttpClient;
    readonly page?: SourcePageClient;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly jobIntakePolicy?: JobIntakePolicy;
    readonly options: JobSyncServiceOptions;
  }) {
    this.#uow = input.uow;
    this.#registry = input.registry;
    this.#artifacts = input.artifacts;
    this.#http = input.http;
    this.#page = input.page;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#normalizerVersion = input.options.normalizerVersion;
    this.#maximumInlineRawBytes = input.options.maximumInlineRawBytes ?? 128 * 1024;
    this.#unseenBatchSize = input.options.unseenBatchSize ?? 100;
    this.#jobIntakePolicy = input.jobIntakePolicy;
  }

  async #prepareRaw(value: unknown, capturedAt: UtcInstant): Promise<PreparedRaw> {
    const payload = sanitizeRaw(value);
    const serialized = canonicalJson(payload);
    const bytes = new TextEncoder().encode(serialized);
    const hash = contentHash(payload);
    if (bytes.byteLength <= this.#maximumInlineRawBytes) {
      return { contentHash: hash, payload, artifactId: null };
    }
    const artifact = await this.#artifacts.put({
      id: this.#ids.generate(),
      kind: 'raw_job',
      mediaType: 'application/json',
      content: bytes,
      createdAt: capturedAt,
    });
    return { contentHash: hash, payload: null, artifactId: artifact.id };
  }

  #persistRaw(input: {
    readonly sourceId: JobSourceId;
    readonly runId: SyncRunId;
    readonly job: DiscoveredJob;
    readonly prepared: PreparedRaw;
    readonly capturedAt: UtcInstant;
  }): string {
    return this.#uow.run(
      ({ sync }) =>
        sync.persistRawJob({
          id: this.#ids.generate(),
          sourceId: input.sourceId,
          syncRunId: input.runId,
          externalJobId: input.job.externalJobId,
          identityKey: input.job.externalJobId,
          sourceUrl: input.job.sourceUrl,
          contentHash: input.prepared.contentHash,
          payload: input.prepared.payload,
          artifactId: input.prepared.artifactId,
          capturedAt: input.capturedAt,
        }).id,
    );
  }

  #recordIsolated(input: {
    readonly sourceId: JobSourceId;
    readonly runId: SyncRunId;
    readonly job: DiscoveredJob;
    readonly rawRecordId: string;
    readonly observedAt: UtcInstant;
    readonly explicitNotFound: boolean;
    readonly policyVersion: string;
    readonly stats: MutableSyncRunStats;
  }): void {
    this.#uow.run(({ jobs }) => {
      const current = jobs.findCurrent({
        sourceId: input.sourceId,
        externalJobId: input.job.externalJobId,
      });
      if (!current) return;
      jobs.recordObservation({
        jobId: current.jobId,
        syncRunId: input.runId,
        rawRecordId: input.rawRecordId,
        observedAt: input.observedAt,
      });
      const transition = input.explicitNotFound
        ? decideExplicitClosure(current.lifecycle, input.observedAt)
        : decideObservedTransition(current.lifecycle, input.observedAt);
      jobs.persistStatus({
        jobId: current.jobId,
        lifecycle: transition.next,
        syncRunId: input.runId,
        eventId: transition.event ? this.#ids.generate() : null,
        fromStatus: current.lifecycle.status,
        reason: transition.event?.reason ?? null,
        occurredAt: input.observedAt,
        evidence: { policyVersion: input.policyVersion, rawRecordId: input.rawRecordId },
      });
      if (transition.event?.reason === 'reobserved') input.stats.restored += 1;
      if (transition.event?.reason === 'explicitly_closed') input.stats.closed += 1;
    });
  }

  async #processJob(input: {
    readonly source: SyncSourceRecord;
    readonly runId: SyncRunId;
    readonly adapter: ReturnType<AdapterRegistry['resolve']>['adapter'];
    readonly config: unknown;
    readonly eventJob: unknown;
    readonly signal: AbortSignal;
    readonly stats: MutableSyncRunStats;
  }): Promise<void> {
    const observedAt = this.#clock.now();
    const discovered = discoveredJobSchema.parse(input.eventJob);
    const job: DiscoveredJob = {
      ...discovered,
      sourceUrl: canonicalizeOfficialUrl(
        discovered.sourceUrl,
        input.adapter.metadata.officialHosts,
      ),
    };
    const listContentHash = contentHash(job.raw);
    const cachedDetail =
      input.adapter.metadata.capabilities.detail === 'deferred'
        ? this.#uow.run(({ sync }) =>
            sync.getCachedJobDetail(
              input.source.id,
              job.externalJobId,
              listContentHash,
              input.adapter.metadata.version,
            ),
          )
        : null;
    const detailCacheIsCurrent = cachedDetail?.listContentHash === listContentHash;
    const detail = cachedDetail?.detail ?? null;

    const prepared = await this.#prepareRaw({ discovered: job.raw, detail }, observedAt);

    let normalized: NormalizedSourceJob;
    try {
      const normalizedSourceJob = await input.adapter.normalize(
        { discovered: job, detail },
        { sourceId: input.source.id, companyId: input.source.companyId, config: input.config },
      );
      const taxonomy = canonicalizeJobTaxonomy(normalizedSourceJob.job);
      normalized = {
        ...normalizedSourceJob,
        job: {
          ...normalizedSourceJob.job,
          jobFamily: taxonomy.jobFamily,
          jobSubfamily: taxonomy.jobSubfamily,
        },
      };
      if (
        normalized.job.sourceId !== input.source.id ||
        normalized.job.companyId !== input.source.companyId ||
        normalized.job.externalJobId !== job.externalJobId
      ) {
        throw new SourceError('parse_changed', 'Adapter normalization changed source identity.');
      }
    } catch (error) {
      const rawRecordId = this.#persistRaw({
        sourceId: input.source.id,
        runId: input.runId,
        job,
        prepared,
        capturedAt: observedAt,
      });
      input.stats.rawStored += 1;
      input.stats.isolated += 1;
      this.#uow.run(({ sync }) => {
        sync.recordItemFailure({
          id: this.#ids.generate(),
          runId: input.runId,
          sourceId: input.source.id,
          externalJobId: job.externalJobId,
          stage:
            isSourceError(error) && error.safeDiagnostic.includes('identity')
              ? 'identity'
              : 'normalize',
          errorCategory: isSourceError(error) ? error.category : 'internal',
          errorSummary: isSourceError(error)
            ? error.safeDiagnostic
            : error instanceof Error
              ? error.message.slice(0, 240)
              : 'Adapter normalization failed.',
          rawRecordId,
          occurredAt: observedAt,
        });
      });
      this.#recordIsolated({
        sourceId: input.source.id,
        runId: input.runId,
        job,
        rawRecordId,
        observedAt,
        explicitNotFound: false,
        policyVersion: input.source.syncPolicyVersion,
        stats: input.stats,
      });
      return;
    }

    const region = classifyJobRegion(normalized.job.locations);
    if (region === 'non_domestic') {
      input.stats.skippedNonDomestic += 1;
      return;
    }
    if (region === 'unknown') {
      input.stats.skippedUnknownRegion += 1;
      return;
    }

    if (this.#jobIntakePolicy && !this.#jobIntakePolicy.accepts(normalized.job)) {
      input.stats.skippedOutOfScope += 1;
      return;
    }

    const rawRecordId = this.#persistRaw({
      sourceId: input.source.id,
      runId: input.runId,
      job,
      prepared,
      capturedAt: observedAt,
    });
    input.stats.rawStored += 1;

    this.#uow.run(({ jobs, tasks }) => {
      const current = jobs.findCurrent({
        sourceId: input.source.id,
        externalJobId: job.externalJobId,
      });
      const decision = decideJobMerge(current, normalized.job);
      let revisionId: string | null = null;
      if (decision.type === 'unchanged') {
        jobs.recordObservation({
          jobId: decision.jobId,
          syncRunId: input.runId,
          rawRecordId,
          observedAt,
        });
        input.stats.unchanged += 1;
      } else {
        revisionId = this.#ids.generate();
        jobs.persistMutation({
          decision,
          jobId: decision.type === 'create' ? parseId(this.#ids.generate(), 'Job') : decision.jobId,
          revisionId,
          statusEventId: this.#ids.generate(),
          rawRecordId,
          normalizerVersion: this.#normalizerVersion,
          syncRunId: input.runId,
          observedAt,
        });
        if (decision.type === 'create') input.stats.created += 1;
        else input.stats.revised += 1;
      }

      if (current) {
        const transition = decideObservedTransition(current.lifecycle, observedAt);
        jobs.persistStatus({
          jobId: current.jobId,
          lifecycle: transition.next,
          syncRunId: input.runId,
          eventId: transition.event ? this.#ids.generate() : null,
          fromStatus: current.lifecycle.status,
          reason: transition.event?.reason ?? null,
          occurredAt: observedAt,
          evidence: { policyVersion: input.source.syncPolicyVersion, rawRecordId },
        });
        if (transition.event) input.stats.restored += 1;
      }

      if (
        input.adapter.metadata.capabilities.detail === 'deferred' &&
        !detailCacheIsCurrent &&
        !job.externalJobId.startsWith('-')
      ) {
        const taskId = parseId(this.#ids.generate(), 'Task');
        const enqueued = tasks.enqueue({
          id: taskId,
          taskType: 'source.job-detail',
          payload: {
            sourceId: input.source.id,
            runId: input.runId,
            listContentHash,
            adapterVersion: input.adapter.metadata.version,
            discovered: job,
          },
          priority: 0,
          idempotencyKey: `source.job-detail:${input.source.id}:${job.externalJobId}:${listContentHash}:${input.adapter.metadata.version}`,
          concurrencyKey: `source-detail:${input.source.id}:${job.externalJobId}`,
          scheduleId: null,
          retryOfTaskId: null,
          maxAttempts: 3,
          availableAt: observedAt,
          createdAt: observedAt,
        });
        if (enqueued.kind === 'enqueued') input.stats.followupEnqueued += 1;
      }
    });
  }

  #source(sourceId: JobSourceId): SyncSourceRecord | null {
    return this.#uow.run(({ sync }) => sync.getSource(sourceId));
  }

  #processUnseen(input: {
    readonly source: SyncSourceRecord;
    readonly runId: SyncRunId;
    readonly stats: MutableSyncRunStats;
  }): void {
    for (;;) {
      const processed = this.#uow.run(({ jobs, sync }) => {
        const unseen = sync.findUnseenJobs(input.source.id, input.runId, this.#unseenBatchSize);
        for (const current of unseen) {
          const transition = decideMissingTransition(
            current.lifecycle,
            'complete',
            input.source.syncPolicy,
            this.#clock.now(),
          );
          jobs.persistStatus({
            jobId: current.jobId,
            lifecycle: transition.next,
            syncRunId: input.runId,
            eventId: transition.event ? this.#ids.generate() : null,
            fromStatus: current.lifecycle.status,
            reason: transition.event?.reason ?? null,
            occurredAt: this.#clock.now(),
            evidence: { policyVersion: input.source.syncPolicyVersion, coverage: 'complete' },
          });
          sync.markMissingProcessed(input.runId, current.jobId);
          if (transition.event?.reason === 'missing_threshold_stale') input.stats.staled += 1;
          if (transition.event?.reason === 'missing_threshold_closed') input.stats.closed += 1;
        }
        return unseen.length;
      });
      if (processed === 0) return;
    }
  }

  public async run(
    command: { readonly sourceId: JobSourceId; readonly trigger: SyncTrigger },
    signal: AbortSignal,
  ): Promise<JobSyncResult> {
    const source = this.#source(command.sourceId);
    if (!source?.enabled) throw new SourceError('invalid_config', 'Source is not enabled.');
    const registered = this.#registry.resolve(source.adapterKey, source.config);
    const runId = parseId(this.#ids.generate(), 'SyncRun');
    const startedAt = this.#clock.now();
    const start = this.#uow.run(({ sync }) =>
      sync.startRun({
        id: runId,
        sourceId: source.id,
        trigger: command.trigger,
        coverage: 'unknown',
        adapterVersion: registered.metadata.version,
        normalizerVersion: this.#normalizerVersion,
        syncPolicyVersion: source.syncPolicyVersion,
        sourceConfigHash: contentHash(source.config),
        cursorIn: source.cursor,
        startedAt,
      }),
    );
    if (start.kind === 'conflict') return { kind: 'conflict', runId: start.runId };

    const stats = emptyStats();
    let completion: Extract<DiscoveryEvent, { type: 'complete' }> | null = null;
    let runError: unknown = null;
    try {
      const context = {
        sourceId: source.id,
        companyId: source.companyId,
        requestId: String(runId),
        config: registered.config,
        signal,
        timeoutMs: source.syncPolicy.requestTimeoutMs,
        http: this.#http,
        ...(this.#page ? { page: this.#page } : {}),
        cursor: source.cursor,
      };
      for await (const event of registered.adapter.discover(context)) {
        if (signal.aborted) throw new SourceError('temporary', 'Sync was cancelled.');
        if (event.type === 'complete') {
          if (completion) throw new SourceError('parse_changed', 'Duplicate completion event.');
          completion = event;
          continue;
        }
        if (event.type !== 'job') continue;
        if (completion) throw new SourceError('parse_changed', 'Job event followed completion.');
        stats.discovered += 1;
        await this.#processJob({
          source,
          runId,
          adapter: registered.adapter,
          config: registered.config,
          eventJob: event.job,
          signal,
          stats,
        });
      }
      if (!completion)
        throw new SourceError('parse_changed', 'Discovery ended without completion.');
    } catch (error) {
      runError = error;
    }

    let coverage: SyncCoverage =
      completion?.coverage ?? (stats.discovered > 0 ? 'partial' : 'unknown');
    const cancelled = signal.aborted;
    if (runError || cancelled) coverage = stats.discovered > 0 ? 'partial' : 'unknown';
    if (!runError && !cancelled && completion?.coverage === 'complete') {
      try {
        this.#processUnseen({ source, runId, stats });
      } catch (error) {
        runError = error;
        coverage = 'partial';
      }
    }

    const severeIsolationThreshold = Math.max(5, Math.ceil(stats.discovered * 0.05));
    const severeIsolation = stats.isolated > severeIsolationThreshold;
    let status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
    if (cancelled) status = 'cancelled';
    else if (runError && stats.discovered === 0) status = 'failed';
    else if (runError || coverage !== 'complete' || severeIsolation) status = 'partial';
    else status = 'succeeded';

    try {
      assertStats(stats);
    } catch (error) {
      runError = error;
      status = 'failed';
      coverage = 'partial';
    }
    const listFailed = status === 'failed' || coverage !== 'complete';
    const failures = listFailed ? source.consecutiveFailures + 1 : 0;
    const health =
      status === 'succeeded'
        ? 'healthy'
        : failures >= source.syncPolicy.unhealthyAfterFailures
          ? 'unhealthy'
          : 'degraded';
    const completionDiagnostics = completion?.diagnostics ?? null;
    const errorCategory = cancelled
      ? 'cancelled'
      : isSourceError(runError)
        ? runError.category
        : runError
          ? 'internal'
          : coverage !== 'complete'
            ? completionDiagnostics?.retryable
              ? 'temporary'
              : 'partial_coverage'
            : stats.isolated > 0
              ? 'isolated_items'
              : null;
    const errorSummary = isSourceError(runError)
      ? runError.safeDiagnostic
      : runError
        ? 'Sync pipeline failed.'
        : coverage !== 'complete'
          ? (completionDiagnostics?.reason ?? 'Source list coverage was incomplete.')
          : stats.isolated > 0
            ? 'One or more jobs were isolated.'
            : null;
    const finalStats = immutableStats(stats);
    this.#uow.run(({ sync }) => {
      const finished = sync.finishRun({
        runId,
        sourceId: source.id,
        status,
        coverage,
        cursorOut: status === 'succeeded' && completion ? completion.cursor : null,
        stats: finalStats,
        errorCategory,
        errorSummary,
        finishedAt: this.#clock.now(),
        sourceHealth: health,
        consecutiveFailures: failures,
        coverageEvidence: completionDiagnostics ?? {
          expectedCount: null,
          discoveredCount: stats.discovered,
          fetchedPages: completion?.pages ?? 0,
          reason: runError ? 'pipeline_error' : null,
          retryable:
            isSourceError(runError) && ['temporary', 'rate_limited'].includes(runError.category),
        },
      });
      if (!finished) throw new Error('Sync run could not be finalized.');
      sync.cleanupSeen(runId);
    });
    return {
      kind: 'completed',
      runId,
      status,
      coverage,
      stats: finalStats,
      errorCategory,
      errorSummary,
    };
  }
}
