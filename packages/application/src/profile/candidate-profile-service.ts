import {
  mergeProfileVersion,
  parseCandidateProfile,
  parseId,
  type CandidateProfileData,
  type CandidateProfileId,
  type Clock,
  type IdGenerator,
  type ProfileVersionId,
} from '@jobhunter/domain';
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
    // 1、读取当前版本并保留用户偏好，再合并提取事实和锁定字段。
    const current = this.#repository.getCurrentVersion(input.profileId);
    const extracted = current
      ? parseCandidateProfile({
          ...input.extracted,
          preferences: current.effective.preferences,
        })
      : input.extracted;
    const merge = mergeProfileVersion(
      current?.effective ?? null,
      extracted,
      current?.lockedPaths ?? [],
    );
    // 2、在仓储的乐观并发边界内追加新版本，冲突时不覆盖用户最新修改。
    return created(
      this.#repository.appendVersion({
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        version: this.#version({
          profileId: input.profileId,
          current,
          resumeDocumentId: input.resumeDocumentId,
          agentRunId: input.agentRunId,
          extracted,
          effective: merge.effective,
          lockedPaths: merge.lockedPaths,
          contentHash: merge.contentHash,
        }),
      }),
    );
  }

  /** 执行应用组件对外暴露的操作。 */
  public applyManualCorrection(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly lockedPaths?: readonly string[];
  }): ProfileVersionRecord {
    // 1、先读取当前版本并应用人工补丁，再验证锁定路径仍然存在。
    const current = this.#requiredCurrent(input.profileId);
    const merge = mergeProfileVersion(null, current.effective, [], input.patch);
    const locks = input.lockedPaths ?? current.lockedPaths;
    const lockValidation = mergeProfileVersion(merge.effective, merge.effective, locks);
    if (lockValidation.ignoredLockedPaths.length > 0) {
      throw new TypeError('One or more locked profile paths do not exist.');
    }
    // 2、通过同一版本追加入口保存修正，保持版本号和当前标记原子更新。
    return created(
      this.#repository.appendVersion({
        expectedCurrentVersionId: input.expectedCurrentVersionId,
        version: this.#version({
          profileId: input.profileId,
          current,
          resumeDocumentId: current.resumeDocumentId,
          agentRunId: current.agentRunId,
          extracted: current.extracted,
          effective: merge.effective,
          lockedPaths: lockValidation.lockedPaths,
          contentHash: merge.contentHash,
        }),
      }),
    );
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

  /** 构造不可变画像版本记录并递增版本号。 */
  #version(input: {
    readonly profileId: CandidateProfileId;
    readonly current: ProfileVersionRecord | null;
    readonly resumeDocumentId: string | null;
    readonly agentRunId: string | null;
    readonly extracted: CandidateProfileData;
    readonly effective: CandidateProfileData;
    readonly lockedPaths: readonly string[];
    readonly contentHash: ProfileVersionRecord['contentHash'];
  }): ProfileVersionRecord {
    return {
      id: parseId(this.#ids.generate(), 'ProfileVersion'),
      profileId: input.profileId,
      versionNo: (input.current?.versionNo ?? 0) + 1,
      resumeDocumentId: input.resumeDocumentId,
      agentRunId: input.agentRunId,
      extracted: input.extracted,
      effective: input.effective,
      lockedPaths: [...input.lockedPaths],
      contentHash: input.contentHash,
      isCurrent: true,
      createdAt: this.#clock.now(),
    };
  }
}
