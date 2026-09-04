import {
  canonicalJobFamilies,
  normalizeJobTaxonomy,
  type CanonicalJobFamily,
  type NormalizedJob,
} from '@jobhunter/domain';
import type { CandidateProfileRepository } from '../ports/profiles.js';

/** 应用层数据结构或端口契约。 */
export interface JobIntakePolicy {
  allowedJobFamilies(): readonly CanonicalJobFamily[];
  isReady(): boolean;
  accepts(job: Pick<NormalizedJob, 'jobFamily'>): boolean;
}

/** 根据候选人目标岗位族筛选同步职位。 */
export class ProfileJobIntakePolicy implements JobIntakePolicy {
  readonly #profiles: CandidateProfileRepository;

  public constructor(profiles: CandidateProfileRepository) {
    this.#profiles = profiles;
  }

  /** 执行应用组件对外暴露的操作。 */
  public allowedJobFamilies(): readonly CanonicalJobFamily[] {
    const families = new Set<CanonicalJobFamily>();
    for (const profile of this.#profiles.listProfiles()) {
      const version = this.#profiles.getCurrentVersion(profile.id);
      if (!version) continue;
      for (const targetRole of version.effective.targetRoles) {
        const family = normalizeJobTaxonomy(targetRole).jobFamily;
        if (family !== '其他') families.add(family);
      }
    }
    return canonicalJobFamilies.filter((family) => families.has(family));
  }

  /** 判断职位岗位族是否被当前简历目标接受。 */
  public accepts(job: Pick<NormalizedJob, 'jobFamily'>): boolean {
    return this.allowedJobFamilies().includes(
      job.jobFamily as (typeof canonicalJobFamilies)[number],
    );
  }

  /** 执行应用组件对外暴露的操作。 */
  public isReady(): boolean {
    return this.allowedJobFamilies().length > 0;
  }
}
