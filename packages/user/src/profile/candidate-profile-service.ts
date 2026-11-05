import {
  mergeProfileVersion,
  parseCandidateProfile,
  type CandidateProfileData,
} from '@jobhunter/user/domain';
import {
  parseId,
  contentHash,
  type CandidateProfileId,
  type Clock,
  type IdGenerator,
  type ProfileVersionId,
} from '@jobhunter/common/domain';
import type {
  AppendProfileVersionResult,
  CandidateProfileRecord,
  CandidateProfileRepository,
  ProfileVersionRecord,
} from '../ports/profiles.js';

/** 画像当前版本发生并发变化时抛出的乐观并发错误。 */
export class ProfileVersionConflictError extends Error {
  public readonly currentVersionId: ProfileVersionId | null;

  public constructor(currentVersionId: ProfileVersionId | null) {
    super('Candidate profile current version changed.');
    this.name = 'ProfileVersionConflictError';
    this.currentVersionId = currentVersionId;
  }
}

/** 将仓储追加结果转换为版本记录或稳定冲突错误。 */
function created(result: AppendProfileVersionResult): ProfileVersionRecord {
  if (result.kind === 'conflict') throw new ProfileVersionConflictError(result.currentVersionId);
  return result.version;
}

/** 编排候选人画像创建、提取合并、人工修正和版本查询。 */
export class CandidateProfileService {
  readonly #repository: CandidateProfileRepository;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  public constructor(input: {
    readonly repository: CandidateProfileRepository;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#repository = input.repository;
    this.#clock = input.clock;
    this.#ids = input.ids;
  }

  /** 创建一个尚未生成画像版本的候选人聚合。 */
  public createProfile(name: string): CandidateProfileRecord {
    const normalized = name.trim();
    if (!normalized) throw new TypeError('Candidate profile name is required.');
    const now = this.#clock.now();
    return this.#repository.createProfile({
      id: parseId(this.#ids.generate(), 'CandidateProfile'),
      name: normalized,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** 列出候选人画像聚合。 */
  public listProfiles(): readonly CandidateProfileRecord[] {
    return this.#repository.listProfiles();
  }

  /** 查询候选人画像聚合。 */
  public getProfile(profileId: CandidateProfileId): CandidateProfileRecord | null {
    return this.#repository.getProfile(profileId);
  }

  /** 查询当前生效的画像版本。 */
  public getCurrent(profileId: CandidateProfileId): ProfileVersionRecord | null {
    return this.#repository.getCurrentVersion(profileId);
  }

  /** 查询画像的不可变版本历史。 */
  public history(profileId: CandidateProfileId): readonly ProfileVersionRecord[] {
    return this.#repository.listVersions(profileId);
  }

  public applyExtraction(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId | null;
    readonly resumeDocumentId: string;
    readonly agentRunId: string | null;
    readonly extracted: CandidateProfileData;
  }): ProfileVersionRecord {
    // 1、首次提取创建当前画像；已有画像只生成候选，等待用户选择确认。
    const current = this.#repository.getCurrentVersion(input.profileId);
    const effective = this.#projectIdentity(input.extracted, current?.effective ?? null, false);
    return created(
      this.#repository.appendVersion({
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        version: this.#version({
          profileId: input.profileId,
          current,
          resumeDocumentId: input.resumeDocumentId,
          agentRunId: input.agentRunId,
          effective,
          isCandidate: current !== null,
        }),
      }),
    );
  }

  /** 应用用户选中的候选一级字段；基线变化时拒绝覆盖较新的人工编辑。 */
  public confirmExtraction(input: {
    readonly profileId: CandidateProfileId;
    readonly candidateVersionId: ProfileVersionId;
    readonly expectedCurrentVersionId: ProfileVersionId;
    readonly fields: readonly (keyof CandidateProfileData)[];
  }): ProfileVersionRecord {
    const current = this.#requiredCurrent(input.profileId);
    const candidate = this.#repository.getVersion(input.candidateVersionId);
    if (!candidate || !candidate.isCandidate || candidate.profileId !== input.profileId)
      throw new TypeError('Profile extraction candidate not found.');
    if (candidate.baseVersionId !== current.id || input.expectedCurrentVersionId !== current.id)
      throw new ProfileVersionConflictError(current.id);
    if (!input.fields.length || input.fields.some((key) => !(key in candidate.effective)))
      throw new TypeError('Select valid profile fields to apply.');
    const patch = Object.fromEntries(input.fields.map((key) => [key, candidate.effective[key]]));
    const effective = this.#projectIdentity(
      parseCandidateProfile({ ...current.effective, ...patch }),
      current.effective,
      true,
    );
    return created(
      this.#repository.appendVersion({
        expectedCurrentVersionId: current.id,
        version: this.#version({
          profileId: input.profileId,
          current,
          resumeDocumentId: candidate.resumeDocumentId,
          agentRunId: candidate.agentRunId,
          effective,
          isCandidate: false,
        }),
      }),
    );
  }

  /** 人工修正直接产生生效版本；不再维护锁定路径或提取副本。 */
  public applyManualCorrection(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId;
    readonly patch: Readonly<Record<string, unknown>>;
  }): ProfileVersionRecord {
    const current = this.#requiredCurrent(input.profileId);
    const merged = mergeProfileVersion(null, current.effective, [], input.patch).effective;
    const effective = this.#projectIdentity(merged, current.effective, true);
    return created(
      this.#repository.appendVersion({
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        version: this.#version({
          profileId: input.profileId,
          current,
          resumeDocumentId: current.resumeDocumentId,
          agentRunId: current.agentRunId,
          effective,
          isCandidate: false,
        }),
      }),
    );
  }

  /** 系统分配项目身份，编辑按 ID 保留，提取按唯一名称对齐；不按数组位置误关联。 */
  #projectIdentity(
    profile: CandidateProfileData,
    previous: CandidateProfileData | null,
    manual: boolean,
  ): CandidateProfileData {
    const used = new Set<string>();
    const projects = profile.projects.map((project) => {
      const matches =
        previous?.projects.filter((old) =>
          manual && project.id ? old.id === project.id : old.name === project.name,
        ) ?? [];
      const existing = matches.length === 1 ? matches[0] : undefined;
      const id = existing?.id && !used.has(existing.id) ? existing.id : this.#ids.generate();
      used.add(id);
      return {
        ...project,
        id,
        local_path:
          manual && Object.hasOwn(project, 'local_path')
            ? (project.local_path ?? null)
            : (existing?.local_path ?? null),
      };
    });
    return parseCandidateProfile({ ...profile, projects });
  }

  /** 将用户求职偏好作为人工修正写入新画像版本。 */
  public updatePreferences(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId;
    readonly preferences: CandidateProfileData['preferences'];
  }): ProfileVersionRecord {
    return this.applyManualCorrection({
      profileId: input.profileId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      patch: { preferences: input.preferences },
    });
  }

  /** 获取当前画像版本，不存在时返回稳定错误。 */
  #requiredCurrent(profileId: CandidateProfileId): ProfileVersionRecord {
    const current = this.#repository.getCurrentVersion(profileId);
    if (!current) throw new TypeError('Candidate profile has no current version.');
    return current;
  }

  /** 候选与已确认版本共用独立序号，候选不会更新当前指针。 */
  #version(input: {
    readonly profileId: CandidateProfileId;
    readonly current: ProfileVersionRecord | null;
    readonly resumeDocumentId: string | null;
    readonly agentRunId: string | null;
    readonly effective: CandidateProfileData;
    readonly isCandidate: boolean;
  }): ProfileVersionRecord {
    return {
      id: parseId(this.#ids.generate(), 'ProfileVersion'),
      profileId: input.profileId,
      versionNo:
        Math.max(
          0,
          ...this.#repository.listVersions(input.profileId).map((version) => version.versionNo),
        ) + 1,
      resumeDocumentId: input.resumeDocumentId,
      agentRunId: input.agentRunId,
      effective: input.effective,
      contentHash: contentHash(input.effective),
      isCurrent: !input.isCandidate,
      isCandidate: input.isCandidate,
      baseVersionId: input.isCandidate ? (input.current?.id ?? null) : null,
      createdAt: this.#clock.now(),
    };
  }
}
