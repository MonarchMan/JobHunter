import type { CandidateProfileId, ProfileVersionId } from '@jobhunter/common/domain';
import type { CandidateProfileRecord, ProfileVersionRecord } from '../ports/profiles.js';
export * from '../domain/interview/index.js';
export * from '../domain/profile/index.js';

/** 首页等聚合只需要资料是否存在与当前版本身份，不加载或解析简历正文。 */
export interface ProfileIdentityReader {
  hasProfiles(): boolean;
  currentVersionIds(): readonly string[];
}

/** 匹配批次和结果列表只读取当前版本身份，不解析完整画像。 */
export interface MatchingProfileIdentityReader {
  currentVersionId(profileId: CandidateProfileId): ProfileVersionId | null;
  currentVersionIdsPage(input: {
    readonly afterId: string | null;
    readonly limit: number;
  }): readonly ProfileVersionId[];
}

/** 匹配侧只读用户画像快照；实现者不得通过此接口写入画像或版本。 */
export interface CandidateProfileReader {
  listProfiles(): readonly CandidateProfileRecord[];
  getProfile(profileId: CandidateProfileId): CandidateProfileRecord | null;
  getCurrentVersion(profileId: CandidateProfileId): ProfileVersionRecord | null;
  getVersion(versionId: ProfileVersionId): ProfileVersionRecord | null;
}
