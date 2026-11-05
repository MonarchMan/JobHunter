import { parseId } from '@jobhunter/common/domain';
import {
  webProfileDetailSchema,
  webProfileMutationSchema,
  webProfileSummarySchema,
  webProfileVersionSchema,
  type WebProfileDetail,
  type WebProfileMutation,
} from '@jobhunter/user/contracts/web';
import type { CandidateProfileService } from '@jobhunter/user/profile/candidate-profile-service';
import type {
  ProfileInspectionService,
  ProfileVersionInspection,
} from '@jobhunter/user/profile/profile-inspection-service';
import type { ProfileManagementService } from '@jobhunter/user/profile/resume-profile-workflow';

/** 将候选人档案服务适配为 Web 查询与变更契约。 */
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

  /** 返回 Web 简历档案摘要列表。 */
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

  /** 返回指定档案的当前版本详情。 */
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

  /** 执行 Web 档案锁定、解锁或字段修改。 */
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
      case 'confirm-extraction':
        this.#profiles.confirmExtraction({
          profileId: parseId(mutation.profileId, 'CandidateProfile'),
          candidateVersionId: parseId(mutation.candidateVersionId, 'ProfileVersion'),
          expectedCurrentVersionId: parseId(mutation.expectedVersionId, 'ProfileVersion'),
          fields: mutation.fields,
        });
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

  /** 处理应用类内部的辅助逻辑。 */
  #version(inspection: ProfileVersionInspection): ReturnType<typeof webProfileVersionSchema.parse> {
    const { version } = inspection;
    return webProfileVersionSchema.parse({
      id: version.id,
      profileId: version.profileId,
      versionNumber: version.versionNo,
      resumeDocumentId: version.resumeDocumentId,
      effective: version.effective,
      isCandidate: version.isCandidate,
      baseVersionId: version.baseVersionId,
      createdAt: new Date(version.createdAt).toISOString(),
      extractionAgent: inspection.extractionAgent,
    });
  }
}
