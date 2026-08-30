import {
  canonicalizeJobTaxonomy,
  contentHash,
  decideJobMerge,
  type Clock,
  type ContentHash,
  type IdGenerator,
  type JobSourceId,
  type SyncRunId,
} from '@jobhunter/domain';
import {
  canonicalizeOfficialUrl,
  isSourceError,
  SourceError,
  type AdapterRegistry,
  type DiscoveredJob,
  type SourceHttpClient,
  type SourcePageClient,
} from '@jobhunter/source-core';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface JobDetailCommand {
  readonly sourceId: JobSourceId;
  readonly runId: SyncRunId;
  readonly listContentHash: ContentHash;
  readonly adapterVersion: string;
  readonly discovered: DiscoveredJob;
}

export class JobDetailService {
  readonly #uow: UnitOfWork;
  readonly #registry: AdapterRegistry;
  readonly #http: SourceHttpClient;
  readonly #page: SourcePageClient | undefined;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #normalizerVersion: string;

  public constructor(input: {
    readonly uow: UnitOfWork;
    readonly registry: AdapterRegistry;
    readonly http: SourceHttpClient;
    readonly page?: SourcePageClient;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly normalizerVersion: string;
  }) {
    this.#uow = input.uow;
    this.#registry = input.registry;
    this.#http = input.http;
    this.#page = input.page;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#normalizerVersion = input.normalizerVersion;
  }

  public async run(command: JobDetailCommand, signal: AbortSignal): Promise<void> {
    const source = this.#uow.run(({ sync }) => sync.getSource(command.sourceId));
    if (!source?.enabled) throw new SourceError('invalid_config', 'Source is not enabled.');
    const registered = this.#registry.resolve(source.adapterKey, source.config);
    if (
      registered.metadata.version !== command.adapterVersion ||
      registered.metadata.capabilities.detail !== 'deferred' ||
      !registered.adapter.fetchDetail
    ) {
      throw new SourceError(
        'invalid_config',
        'Deferred detail task no longer matches its adapter.',
      );
    }

    const discovered: DiscoveredJob = {
      ...command.discovered,
      sourceUrl: canonicalizeOfficialUrl(
        command.discovered.sourceUrl,
        registered.metadata.officialHosts,
      ),
    };
    try {
      const detail = await registered.adapter.fetchDetail(discovered, {
        sourceId: source.id,
        companyId: source.companyId,
        requestId: `${command.runId}:${discovered.externalJobId}:detail`,
        config: registered.config,
        signal,
        timeoutMs: source.syncPolicy.requestTimeoutMs,
        http: this.#http,
        ...(this.#page ? { page: this.#page } : {}),
      });
      const normalizedSourceJob = await registered.adapter.normalize(
        { discovered, detail },
        { sourceId: source.id, companyId: source.companyId, config: registered.config },
      );
      const taxonomy = canonicalizeJobTaxonomy(normalizedSourceJob.job);
      const normalized = {
        ...normalizedSourceJob.job,
        jobFamily: taxonomy.jobFamily,
        jobSubfamily: taxonomy.jobSubfamily,
      };
      if (
        normalized.sourceId !== source.id ||
        normalized.companyId !== source.companyId ||
        normalized.externalJobId !== discovered.externalJobId
      ) {
        throw new SourceError(
          'parse_changed',
          'Adapter detail normalization changed source identity.',
        );
      }

      const occurredAt = this.#clock.now();
      this.#uow.run(({ jobs, sync }) => {
        sync.recordJobDetailSuccess({
          sourceId: source.id,
          externalJobId: discovered.externalJobId,
          listContentHash: command.listContentHash,
          adapterVersion: command.adapterVersion,
          detail,
          fetchedAt: occurredAt,
        });
        const sourcePayloadHash = contentHash({ discovered: discovered.raw, detail });
        const current = jobs.findCurrent({
          sourceId: source.id,
          externalJobId: discovered.externalJobId,
        });
        if (!current) return;
        const decision = decideJobMerge(current, normalized);
        if (decision.type !== 'revise') return;
        jobs.persistDetailRevision({
          decision,
          revisionId: this.#ids.generate(),
          sourcePayloadHash,
          sourceUrl: discovered.sourceUrl,
          normalizerVersion: this.#normalizerVersion,
          occurredAt,
        });
      });
    } catch (error) {
      const occurredAt = this.#clock.now();
      this.#uow.run(({ sync }) => {
        sync.recordJobDetailFailure({
          sourceId: source.id,
          externalJobId: discovered.externalJobId,
          listContentHash: command.listContentHash,
          adapterVersion: command.adapterVersion,
          errorCategory: isSourceError(error) ? error.category : 'internal',
          errorSummary: isSourceError(error)
            ? error.safeDiagnostic
            : error instanceof Error
              ? error.message.slice(0, 240)
              : 'Deferred detail enrichment failed.',
          occurredAt,
        });
      });
      if (isSourceError(error)) throw error;
      throw new SourceError('parse_changed', 'Deferred detail enrichment failed.', {
        cause: error,
      });
    }
  }
}
