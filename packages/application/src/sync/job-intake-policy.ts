import {
  canonicalJobFamilies,
  normalizeJobTaxonomy,
  type CanonicalJobFamily,
  type NormalizedJob,
} from '@jobhunter/domain';
import type { CandidateProfileRepository } from '../ports/profiles.js';

export interface JobIntakePolicy {
  allowedJobFamilies(): readonly CanonicalJobFamily[];
  accepts(job: Pick<NormalizedJob, 'jobFamily'>): boolean;
}

export class ProfileJobIntakePolicy implements JobIntakePolicy {
  readonly #profiles: CandidateProfileRepository;

  public constructor(profiles: CandidateProfileRepository) {
    this.#profiles = profiles;
  }

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

  public accepts(job: Pick<NormalizedJob, 'jobFamily'>): boolean {
    return this.allowedJobFamilies().includes(
      job.jobFamily as (typeof canonicalJobFamilies)[number],
    );
  }
}
