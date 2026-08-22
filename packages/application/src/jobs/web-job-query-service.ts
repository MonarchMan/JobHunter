import {
  webJobPageSchema,
  webJobQuerySchema,
  type WebJobPage,
  type WebJobQuery,
} from '../contracts/web.js';
import type { JobQueryService } from './job-query-service.js';

export class WebJobQueryService {
  readonly #jobs: JobQueryService;

  public constructor(jobs: JobQueryService) {
    this.#jobs = jobs;
  }

  public list(input: WebJobQuery): WebJobPage {
    const query = webJobQuerySchema.parse(input);
    const page = this.#jobs.list({
      sort: query.sort,
      limit: query.limit,
      ...(query.search ? { search: query.search } : {}),
      ...(query.companies ? { companies: query.companies } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.locations ? { locations: query.locations } : {}),
      ...(query.jobFamilies ? { jobFamilies: query.jobFamilies } : {}),
      ...(query.minimumScore === undefined ? {} : { minimumScore: query.minimumScore }),
      ...(query.profileVersionId ? { profileVersionId: query.profileVersionId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return webJobPageSchema.parse({
      items: page.items.map((job) => ({
        ...job,
        publishedAt: job.publishedAt === null ? null : new Date(job.publishedAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
      })),
      nextCursor: page.nextCursor,
    });
  }
}
