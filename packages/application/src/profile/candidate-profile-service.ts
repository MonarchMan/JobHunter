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

export class ProfileVersionConflictError extends Error {
  public readonly currentVersionId: ProfileVersionId | null;

  public constructor(currentVersionId: ProfileVersionId | null) {
    super('Candidate profile current version changed.');
    this.name = 'ProfileVersionConflictError';
    this.currentVersionId = currentVersionId;
  }
}

function created(result: AppendProfileVersionResult): ProfileVersionRecord {
  if (result.kind === 'conflict') throw new ProfileVersionConflictError(result.currentVersionId);
  return result.version;
}

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

  public listProfiles(): readonly CandidateProfileRecord[] {
    return this.#repository.listProfiles();
  }

  public getProfile(profileId: CandidateProfileId): CandidateProfileRecord | null {
    return this.#repository.getProfile(profileId);
  }

  public getCurrent(profileId: CandidateProfileId): ProfileVersionRecord | null {
    return this.#repository.getCurrentVersion(profileId);
  }

  public history(profileId: CandidateProfileId): readonly ProfileVersionRecord[] {
    return this.#repository.listVersions(profileId);
  }

  public applyExtraction(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId | null;
    readonly resumeDocumentId: string;
    readonly agentRunId: string;
    readonly extracted: CandidateProfileData;
  }): ProfileVersionRecord {
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

  public applyManualCorrection(input: {
    readonly profileId: CandidateProfileId;
    readonly expectedCurrentVersionId: ProfileVersionId;
    readonly patch: Readonly<Record<string, unknown>>;
    readonly lockedPaths?: readonly string[];
  }): ProfileVersionRecord {
    const current = this.#requiredCurrent(input.profileId);
    const merge = mergeProfileVersion(null, current.effective, [], input.patch);
    const locks = input.lockedPaths ?? current.lockedPaths;
    const lockValidation = mergeProfileVersion(merge.effective, merge.effective, locks);
    if (lockValidation.ignoredLockedPaths.length > 0) {
      throw new TypeError('One or more locked profile paths do not exist.');
    }
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

  #requiredCurrent(profileId: CandidateProfileId): ProfileVersionRecord {
    const current = this.#repository.getCurrentVersion(profileId);
    if (!current) throw new TypeError('Candidate profile has no current version.');
    return current;
  }

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
