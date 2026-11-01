import type { CompanyId, JobId, JobRevisionId, UtcInstant } from '@jobhunter/common/domain';
import type { JobStatus, NormalizedJob } from '../domain/index.js';

/** 匹配输入的不可变职位修订快照，由招聘模块拥有并校验。 */
export interface RecruitmentMatchingRevision {
  readonly id: JobRevisionId;
  readonly jobId: JobId;
  readonly jobStatus: JobStatus;
  readonly normalized: NormalizedJob;
  readonly createdAt: UtcInstant;
  readonly lastSeenAt: UtcInstant;
}

/** 当前职位事实，用于匹配结果的有效性与排序判断，不包含完整正文。 */
export interface CurrentMatchingJobFact {
  readonly jobId: string;
  readonly revisionId: string;
  readonly title: string;
  readonly status: JobStatus;
  readonly publishedAt: number | null;
  readonly lastSeenAt: number;
}

/** 匹配侧只读招聘查询能力，不提供写入或数据库访问。 */
export interface MatchingJobReader {
  getRevision(id: JobRevisionId): RecruitmentMatchingRevision | null;
  getLatestRevisionForJob(jobId: JobId): RecruitmentMatchingRevision | null;
  getCompanyContext(companyId: CompanyId): {
    readonly industry: string | null;
    readonly sizeCategory: 'large' | 'medium' | 'other' | null;
  };
  listLatestRevisionIdsPage(input: {
    readonly afterId: string | null;
    readonly limit: number;
    readonly statuses: readonly JobStatus[];
    readonly targetRoles?: readonly string[];
    readonly excludedTerms?: readonly string[];
  }): readonly JobRevisionId[];
  listCurrentJobFacts(): readonly CurrentMatchingJobFact[];
}
