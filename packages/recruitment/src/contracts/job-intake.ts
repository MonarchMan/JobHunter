import type { CanonicalJobFamily, NormalizedJob } from '@jobhunter/recruitment/domain';

/** 招聘同步使用的岗位范围判定端口；实现由入口注入，不读取个人资料表。 */
export interface JobIntakePolicy {
  allowedJobFamilies(): readonly CanonicalJobFamily[];
  isReady(): boolean;
  accepts(job: Pick<NormalizedJob, 'jobFamily'>): boolean;
}
