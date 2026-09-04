import type {
  CompanyId,
  JobId,
  JobSourceId,
  JobStatus,
  ProfileVersionId,
  UtcInstant,
} from '@jobhunter/domain';

/** 应用层使用的类型约束。 */
export type JobQuerySort = 'updated_desc' | 'published_desc' | 'score_desc';
/** 应用层使用的类型约束。 */
export type RecruitmentCategory = 'internship' | 'campus' | 'social';

/** 应用层数据结构或端口契约。 */
export interface JobQueryFilter {
  readonly search?: string;
  readonly companyIds?: readonly CompanyId[];
  readonly statuses?: readonly JobStatus[];
  readonly locations?: readonly string[];
  readonly jobFamilies?: readonly string[];
  readonly jobSubfamilies?: readonly string[];
  readonly recruitmentCategory?: RecruitmentCategory;
  readonly minimumScore?: number;
  readonly profileVersionId?: ProfileVersionId;
  readonly sort?: JobQuerySort;
  readonly page?: number;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly limit?: number;
}

/** 应用层数据结构或端口契约。 */
export interface JobListItem {
  readonly id: JobId;
  readonly companyId: CompanyId;
  readonly companyName: string;
  readonly title: string;
  readonly department: string | null;
  readonly jobFamily: string | null;
  readonly jobSubfamily: string | null;
  readonly recruitmentCategory: RecruitmentCategory | null;
  readonly locations: readonly string[];
  readonly status: JobStatus;
  readonly detailUrl: string;
  readonly applyUrl: string;
  readonly publishedAt: UtcInstant | null;
  readonly updatedAt: UtcInstant;
  readonly score: number | null;
}

/** 应用层数据结构或端口契约。 */
export interface JobDetail extends JobListItem {
  readonly sourceId: JobSourceId;
  readonly externalJobId: string;
  readonly employmentType: string | null;
  readonly recruitmentCategory: 'internship' | 'campus' | 'social' | null;
  readonly experienceText: string | null;
  readonly educationText: string | null;
  readonly description: string;
  readonly firstSeenAt: UtcInstant;
  readonly lastSeenAt: UtcInstant;
  readonly closedAt: UtcInstant | null;
}

/** 应用层数据结构或端口契约。 */
export interface JobQueryPage {
  readonly items: readonly JobListItem[];
  readonly nextCursor: string | null;
  readonly total?: number;
  readonly page?: number;
  readonly pageSize?: number;
}

/** 应用层数据结构或端口契约。 */
export interface JobQueryRepository {
  query(filter: JobQueryFilter): JobQueryPage;
  get(jobId: JobId, profileVersionId?: ProfileVersionId): JobDetail | null;
}

/** 应用层数据结构或端口契约。 */
export interface CompanySummary {
  readonly id: CompanyId;
  readonly slug: string;
  readonly name: string;
}

/** 应用层数据结构或端口契约。 */
export interface CompanyLookupRepository {
  findBySelector(selector: string): CompanySummary | null;
}

/** 应用层数据结构或端口契约。 */
export interface JobExportFileStore {
  writeAtomic(
    path: string,
    content: string,
  ): Promise<{ readonly path: string; readonly bytes: number }>;
}
