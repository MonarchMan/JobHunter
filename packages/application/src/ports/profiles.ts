import type {
  CandidateProfileData,
  CandidateProfileId,
  ContentHash,
  ProfileVersionId,
  UtcInstant,
} from '@jobhunter/domain';

/** 应用层数据结构或端口契约。 */
export interface CandidateProfileRecord {
  readonly id: CandidateProfileId;
  readonly name: string;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ProfileVersionRecord {
  readonly id: ProfileVersionId;
  readonly profileId: CandidateProfileId;
  readonly versionNo: number;
  readonly resumeDocumentId: string | null;
  readonly agentRunId: string | null;
  readonly extracted: CandidateProfileData;
  readonly effective: CandidateProfileData;
  readonly lockedPaths: readonly string[];
  readonly contentHash: ContentHash;
  readonly isCurrent: boolean;
  readonly createdAt: UtcInstant;
}

/** 应用层使用的类型约束。 */
export type AppendProfileVersionResult =
  | { readonly kind: 'created'; readonly version: ProfileVersionRecord }
  | { readonly kind: 'conflict'; readonly currentVersionId: ProfileVersionId | null };

/** 应用层数据结构或端口契约。 */
export interface CandidateProfileRepository {
  createProfile(profile: CandidateProfileRecord): CandidateProfileRecord;
  listProfiles(): readonly CandidateProfileRecord[];
  getProfile(profileId: CandidateProfileId): CandidateProfileRecord | null;
  getCurrentVersion(profileId: CandidateProfileId): ProfileVersionRecord | null;
  getVersion(versionId: ProfileVersionId): ProfileVersionRecord | null;
  listVersions(profileId: CandidateProfileId): readonly ProfileVersionRecord[];
  appendVersion(input: {
    readonly expectedCurrentVersionId: ProfileVersionId | null;
    readonly version: ProfileVersionRecord;
  }): AppendProfileVersionResult;
}
