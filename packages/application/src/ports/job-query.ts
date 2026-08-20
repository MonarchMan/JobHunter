import type {
  CompanyId,
  JobId,
  JobSourceId,
  JobStatus,
  ProfileVersionId,
  UtcInstant,
} from '@jobhunter/domain';

export type JobQuerySort = 'updated_desc' | 'published_desc' | 'score_desc';

export interface JobQueryFilter {
  readonly search?: string;
  readonly companyIds?: readonly CompanyId[];
  readonly statuses?: readonly JobStatus[];
  readonly locations?: readonly string[];
  readonly jobFamilies?: readonly string[];
  readonly minimumScore?: number;
  readonly profileVersionId?: ProfileVersionId;
  readonly sort?: JobQuerySort;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface JobListItem {
  readonly id: JobId;
  readonly companyId: CompanyId;
  readonly companyName: string;
  readonly title: string;
  readonly department: string | null;
  readonly jobFamily: string | null;
  readonly locations: readonly string[];
  readonly status: JobStatus;
  readonly detailUrl: string;
  readonly applyUrl: string;
  readonly publishedAt: UtcInstant | null;
  readonly updatedAt: UtcInstant;
  readonly score: number | null;
}

export interface JobDetail extends JobListItem {
  readonly sourceId: JobSourceId;
  readonly externalJobId: string;
  readonly employmentType: string | null;
  readonly experienceText: string | null;
  readonly educationText: string | null;
  readonly description: string;
  readonly firstSeenAt: UtcInstant;
  readonly lastSeenAt: UtcInstant;
  readonly closedAt: UtcInstant | null;
}

export interface JobQueryPage {
  readonly items: readonly JobListItem[];
  readonly nextCursor: string | null;
}

export interface JobQueryRepository {
  query(filter: JobQueryFilter): JobQueryPage;
  get(jobId: JobId, profileVersionId?: ProfileVersionId): JobDetail | null;
}

export interface CompanySummary {
  readonly id: CompanyId;
  readonly slug: string;
  readonly name: string;
}

export interface CompanyLookupRepository {
  findBySelector(selector: string): CompanySummary | null;
}

export interface JobExportFileStore {
  writeAtomic(
    path: string,
    content: string,
  ): Promise<{ readonly path: string; readonly bytes: number }>;
}
