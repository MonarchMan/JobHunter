import {
  webPagination,
  webJobPageSchema,
  webJobQuerySchema,
  type WebJobPage,
  type WebJobQuery,
} from '../contracts/web.js';
import type { JobQueryService } from './job-query-service.js';

/** 将职位查询服务适配为 Web 分页契约。 */
export class WebJobQueryService {
  readonly #jobs: JobQueryService;

  public constructor(jobs: JobQueryService) {
    this.#jobs = jobs;
  }

  /** 返回 Web 页面所需的职位列表和下一页游标。 */
  public list(input: WebJobQuery): WebJobPage {
    const query = webJobQuerySchema.parse(input);
    const page = this.#jobs.list({
      sort: query.sort,
      page: query.page,
      pageSize: query.limit ?? query.pageSize,
      ...(query.search ? { search: query.search } : {}),
      ...(query.companies ? { companies: query.companies } : {}),
      ...(query.statuses ? { statuses: query.statuses } : {}),
      ...(query.locations ? { locations: query.locations } : {}),
      ...(query.jobSubfamilies ? { jobSubfamilies: query.jobSubfamilies } : {}),
      recruitmentCategory: query.recruitmentCategory,
      ...(query.minimumScore === undefined ? {} : { minimumScore: query.minimumScore }),
      ...(query.profileVersionId ? { profileVersionId: query.profileVersionId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const pagination = webPagination(
      page.total ?? page.items.length,
      page.page ?? query.page,
      page.pageSize ?? query.limit ?? query.pageSize,
    );
    return webJobPageSchema.parse({
      items: page.items.map((job) => ({
        ...job,
        publishedAt: job.publishedAt === null ? null : new Date(job.publishedAt).toISOString(),
        updatedAt: new Date(job.updatedAt).toISOString(),
      })),
      nextCursor: page.nextCursor,
      page: pagination,
      hasPreviousPage: pagination.current > 1,
      hasNextPage:
        page.total === undefined
          ? page.nextCursor !== null
          : pagination.current < pagination.totalPages,
    });
  }
}
