import { parseId, type JobStatus } from '@jobhunter/domain';
import type {
  CompanyLookupRepository,
  JobDetail,
  JobExportFileStore,
  JobListItem,
  JobQueryFilter,
  JobQueryPage,
  JobQueryRepository,
  JobQuerySort,
} from '../ports/job-query.js';

export class JobNotFoundError extends Error {
  public constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = 'JobNotFoundError';
  }
}

export class CompanyNotFoundError extends Error {
  public constructor(selector: string) {
    super(`Company not found: ${selector}`);
    this.name = 'CompanyNotFoundError';
  }
}

export interface JobSearchInput {
  readonly search?: string;
  readonly companies?: readonly string[];
  readonly statuses?: readonly JobStatus[];
  readonly locations?: readonly string[];
  readonly jobFamilies?: readonly string[];
  readonly jobSubfamilies?: readonly string[];
  readonly recruitmentCategory?: 'internship' | 'campus' | 'social';
  readonly minimumScore?: number;
  readonly profileVersionId?: string;
  readonly sort?: JobQuerySort;
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly limit?: number;
}

export class JobQueryService {
  readonly #jobs: JobQueryRepository;
  readonly #companies: CompanyLookupRepository;

  public constructor(input: {
    readonly jobs: JobQueryRepository;
    readonly companies: CompanyLookupRepository;
  }) {
    this.#jobs = input.jobs;
    this.#companies = input.companies;
  }

  public list(input: JobSearchInput): JobQueryPage {
    return this.#jobs.query(this.#filter(input));
  }

  public show(id: string, profileVersionId?: string): JobDetail {
    const jobId = parseId(id, 'Job');
    const profile = profileVersionId ? parseId(profileVersionId, 'ProfileVersion') : undefined;
    const job = this.#jobs.get(jobId, profile);
    if (!job) throw new JobNotFoundError(id);
    return job;
  }

  public filter(input: JobSearchInput): JobQueryFilter {
    return this.#filter(input);
  }

  #filter(input: JobSearchInput): JobQueryFilter {
    const companyIds = input.companies?.map((selector) => {
      const company = this.#companies.findBySelector(selector);
      if (!company) throw new CompanyNotFoundError(selector);
      return company.id;
    });
    return {
      ...(input.search ? { search: input.search } : {}),
      ...(companyIds ? { companyIds } : {}),
      // Closed jobs are historical and must only appear through an explicit status filter.
      statuses: input.statuses ?? ['active', 'stale'],
      ...(input.locations ? { locations: input.locations } : {}),
      ...(input.jobFamilies ? { jobFamilies: input.jobFamilies } : {}),
      ...(input.jobSubfamilies ? { jobSubfamilies: input.jobSubfamilies } : {}),
      ...(input.recruitmentCategory ? { recruitmentCategory: input.recruitmentCategory } : {}),
      ...(input.minimumScore === undefined ? {} : { minimumScore: input.minimumScore }),
      ...(input.profileVersionId
        ? { profileVersionId: parseId(input.profileVersionId, 'ProfileVersion') }
        : {}),
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    };
  }
}

export type JobExportFormat = 'json' | 'csv';

export class JobExportService {
  readonly #jobs: JobQueryRepository;
  readonly #query: JobQueryService;
  readonly #files: JobExportFileStore;

  public constructor(input: {
    readonly jobs: JobQueryRepository;
    readonly query: JobQueryService;
    readonly files: JobExportFileStore;
  }) {
    this.#jobs = input.jobs;
    this.#query = input.query;
    this.#files = input.files;
  }

  public async export(input: {
    readonly path: string;
    readonly format: JobExportFormat;
    readonly bom?: boolean;
    readonly filter: JobSearchInput;
  }): Promise<{ readonly path: string; readonly bytes: number; readonly count: number }> {
    const filter = this.#query.filter(input.filter);
    const items: JobListItem[] = [];
    let cursor: string | undefined;
    do {
      const page = this.#jobs.query({ ...filter, limit: 100, ...(cursor ? { cursor } : {}) });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const content =
      input.format === 'json'
        ? `${JSON.stringify({ jobs: items }, null, 2)}\n`
        : `${input.bom ? '\uFEFF' : ''}${csv(items)}`;
    const written = await this.#files.writeAtomic(input.path, content);
    return { ...written, count: items.length };
  }
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(items: readonly JobListItem[]): string {
  const header = [
    'id',
    'companyId',
    'companyName',
    'title',
    'department',
    'jobFamily',
    'locations',
    'status',
    'score',
    'publishedAt',
    'updatedAt',
    'detailUrl',
    'applyUrl',
  ];
  const rows = items.map((job) => [
    job.id,
    job.companyId,
    job.companyName,
    job.title,
    job.department,
    job.jobFamily,
    job.locations.join('|'),
    job.status,
    job.score,
    job.publishedAt,
    job.updatedAt,
    job.detailUrl,
    job.applyUrl,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
