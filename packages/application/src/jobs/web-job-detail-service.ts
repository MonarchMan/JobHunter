import { webJobDetailSchema, type WebJobDetail } from '../contracts/web.js';
import type { JobQueryService } from './job-query-service.js';

export interface WebJobTrace {
  readonly revisions: WebJobDetail['revisions'];
  readonly matches: WebJobDetail['matches'];
}

export interface WebJobTraceRepository {
  get(jobId: string): WebJobTrace;
}

export class WebJobDetailService {
  readonly #jobs: JobQueryService;
  readonly #trace: WebJobTraceRepository;

  public constructor(input: {
    readonly jobs: JobQueryService;
    readonly trace: WebJobTraceRepository;
  }) {
    this.#jobs = input.jobs;
    this.#trace = input.trace;
  }

  public get(id: string, profileVersionId?: string): WebJobDetail {
    const job = this.#jobs.show(id, profileVersionId);
    const trace = this.#trace.get(job.id);
    return webJobDetailSchema.parse({
      ...job,
      publishedAt: job.publishedAt === null ? null : new Date(job.publishedAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
      firstSeenAt: new Date(job.firstSeenAt).toISOString(),
      lastSeenAt: new Date(job.lastSeenAt).toISOString(),
      closedAt: job.closedAt === null ? null : new Date(job.closedAt).toISOString(),
      ...trace,
    });
  }
}
