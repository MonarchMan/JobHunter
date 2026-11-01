import type { JobStatus } from '../domain/index.js';
import type { JobQueryFilter, JobQuerySort, JobQueryPage, JobDetail } from '../ports/job-query.js';
/** 招聘侧职位公开查询输入。 */
export interface JobSearchInput {
  readonly sourceKind?: JobQueryFilter['sourceKind'];
  readonly providerKey?: JobQueryFilter['providerKey'];
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
/** 面向跨模块展示的只读职位查询，不暴露仓储或写入方法。 */
export interface JobQueryReader {
  list(input: JobSearchInput): JobQueryPage;
  show(id: string, profileVersionId?: string): JobDetail;
}
