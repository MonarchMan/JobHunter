import { webJobDetailSchema, type WebJobDetail } from '../contracts/web.js';
import type { JobQueryService } from './job-query-service.js';

/** 应用层数据结构或端口契约。 */
export interface WebJobTrace {
  readonly revisions: WebJobDetail['revisions'];
  readonly matches: WebJobDetail['matches'];
}

/** 应用层数据结构或端口契约。 */
export interface WebJobTraceRepository {
  get(jobId: string): WebJobTrace;
}

/** 组合职位详情和可追溯变化链路。 */
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

  /** 获取 Web 职位详情及追踪信息。 */
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
