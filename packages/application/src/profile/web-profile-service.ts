import { parseId } from '@jobhunter/domain';
import {
  webProfileDetailSchema,
  webProfileMutationSchema,
  webProfileSummarySchema,
  webProfileVersionSchema,
  type WebProfileDetail,
  type WebProfileMutation,
} from '../contracts/web.js';
import type { CandidateProfileService } from './candidate-profile-service.js';
import type {
  ProfileInspectionService,
  ProfileVersionInspection,
} from './profile-inspection-service.js';
import type { ProfileManagementService } from './resume-profile-workflow.js';

export class WebProfileService {
  readonly #profiles: CandidateProfileService;
  readonly #inspection: ProfileInspectionService;
  readonly #management: ProfileManagementService;

  public constructor(input: {
    readonly profiles: CandidateProfileService;
    readonly inspection: ProfileInspectionService;
    readonly management: ProfileManagementService;
  }) {
    this.#profiles = input.profiles;
    this.#inspection = input.inspection;
    this.#management = input.management;
  }

  public list(): readonly ReturnType<typeof webProfileSummarySchema.parse>[] {
    return this.#profiles.listProfiles().map((profile) => {
      const current = this.#profiles.getCurrent(profile.id);
      return webProfileSummarySchema.parse({
        id: profile.id,
        name: profile.name,
        currentVersionId: current?.id ?? null,
        updatedAt: new Date(profile.updatedAt).toISOString(),
      });
    });
  }

  public get(id: string): WebProfileDetail {
    const profileId = parseId(id, 'CandidateProfile');
    const profile = this.#profiles.getProfile(profileId);
    const current = this.#inspection.current(profileId);
    if (!profile || !current) {
      this.#management.show(id);
      throw new TypeError('Candidate profile has no current version.');
    }
    return webProfileDetailSchema.parse({
      profile: {
        id: profile.id,
        name: profile.name,
        currentVersionId: current.version.id,
        updatedAt: new Date(profile.updatedAt).toISOString(),
      },
      current: this.#version(current),
      versions: this.#inspection.history(profileId).map((version) => this.#version(version)),
    });
  }

  public mutate(input: WebProfileMutation): WebProfileDetail {
    const mutation = webProfileMutationSchema.parse(input);
    switch (mutation.kind) {
      case 'replace':
        this.#management.replace(mutation.profileId, mutation.profile, mutation.expectedVersionId);
        break;
      case 'set':
        this.#management.set(
          mutation.profileId,
          mutation.pointer,
          mutation.value,
          mutation.expectedVersionId,
        );
        break;
      case 'lock':
        this.#management.lock(mutation.profileId, mutation.pointer, mutation.expectedVersionId);
        break;
      case 'unlock':
        this.#management.unlock(mutation.profileId, mutation.pointer, mutation.expectedVersionId);
        break;
      case 'preferences':
        this.#management.set(
          mutation.profileId,
          '/preferences',
          mutation.preferences,
          mutation.expectedVersionId,
        );
        break;
    }
    return this.get(mutation.profileId);
  }

  #version(inspection: ProfileVersionInspection): ReturnType<typeof webProfileVersionSchema.parse> {
    const { version } = inspection;
    return webProfileVersionSchema.parse({
      id: version.id,
      profileId: version.profileId,
      versionNumber: version.versionNo,
      resumeDocumentId: version.resumeDocumentId,
      extracted: version.extracted,
      effective: version.effective,
      lockedPaths: version.lockedPaths,
      createdAt: new Date(version.createdAt).toISOString(),
      extractionAgent: inspection.extractionAgent,
    });
  }
}
