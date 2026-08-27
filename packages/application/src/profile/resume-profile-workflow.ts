import { parseId, type CandidateProfileData, type CandidateProfileId } from '@jobhunter/domain';
import { isResumeOcrMediaType } from '@jobhunter/resume';
import type { ResumeFileReader } from '../ports/resume-documents.js';
import type { EnqueueTaskResult } from '../tasks/model.js';
import type { TaskService } from '../tasks/task-service.js';
import type { CandidateProfileRecord } from '../ports/profiles.js';
import {
  ProfileVersionConflictError,
  type CandidateProfileService,
} from './candidate-profile-service.js';
import type {
  ProfileInspectionService,
  ProfileVersionInspection,
} from './profile-inspection-service.js';
import type { ResumeImportService } from './resume-import-service.js';

export class CandidateProfileNotFoundError extends Error {
  public constructor(id: string) {
    super(`Candidate profile not found: ${id}`);
    this.name = 'CandidateProfileNotFoundError';
  }
}

export interface ResumeWorkflowImportResult {
  readonly document: {
    readonly id: string;
    readonly mediaType: string;
    readonly parseStatus: string;
    readonly parserVersion: string | null;
    readonly errorSummary: string | null;
    readonly createdAt: number;
  };
  readonly deduplicated: boolean;
  readonly profileId: CandidateProfileId;
  readonly task: EnqueueTaskResult['task'] | null;
  readonly taskDeduplicated: boolean;
}

export class ResumeProfileWorkflow {
  readonly #files: ResumeFileReader;
  readonly #imports: ResumeImportService;
  readonly #profiles: CandidateProfileService;
  readonly #tasks: TaskService;
  readonly #maximumFileBytes: number;

  public constructor(input: {
    readonly files: ResumeFileReader;
    readonly imports: ResumeImportService;
    readonly profiles: CandidateProfileService;
    readonly tasks: TaskService;
    readonly maximumFileBytes?: number;
  }) {
    this.#files = input.files;
    this.#imports = input.imports;
    this.#profiles = input.profiles;
    this.#tasks = input.tasks;
    this.#maximumFileBytes = input.maximumFileBytes ?? 10 * 1024 * 1024;
  }

  public async import(input: {
    readonly path: string;
    readonly profileId?: string;
    readonly profileName?: string;
    readonly signal: AbortSignal;
  }): Promise<ResumeWorkflowImportResult> {
    return this.importBytes({
      bytes: await this.#files.read(input.path, this.#maximumFileBytes),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.profileName ? { profileName: input.profileName } : {}),
      signal: input.signal,
    });
  }

  public async importBytes(input: {
    readonly bytes: Uint8Array;
    readonly profileId?: string;
    readonly profileName?: string;
    readonly signal: AbortSignal;
  }): Promise<ResumeWorkflowImportResult> {
    if (input.bytes.byteLength > this.#maximumFileBytes) {
      throw new TypeError('Resume file exceeds the size limit.');
    }
    const imported = await this.#imports.import(input.bytes, input.signal);
    const profile = input.profileId
      ? this.#requiredProfile(input.profileId)
      : (this.#profiles.listProfiles()[0] ??
        this.#profiles.createProfile(input.profileName ?? '默认候选人画像'));
    const current = this.#profiles.getCurrent(profile.id);
    const canExtract =
      imported.document.parseStatus === 'parsed' ||
      (imported.document.parseStatus === 'needs_ocr' &&
        isResumeOcrMediaType(imported.document.mediaType));
    const queued = canExtract
      ? this.#tasks.enqueue({
          taskType: 'resume.profile.extract',
          priority: 100,
          payload: {
            profileId: profile.id,
            resumeDocumentId: imported.document.id,
            expectedCurrentVersionId: current?.id ?? null,
          },
          idempotencyKey: `resume.profile.extract:${profile.id}:${imported.document.contentHash}:${current?.id ?? 'initial'}`,
        })
      : null;
    return {
      document: {
        id: imported.document.id,
        mediaType: imported.document.mediaType,
        parseStatus: imported.document.parseStatus,
        parserVersion: imported.document.parserVersion,
        errorSummary: imported.document.errorSummary,
        createdAt: imported.document.createdAt,
      },
      deduplicated: imported.deduplicated,
      profileId: profile.id,
      task: queued?.task ?? null,
      taskDeduplicated: queued ? queued.kind !== 'enqueued' : false,
    };
  }

  #requiredProfile(id: string): CandidateProfileRecord {
    const parsed = parseId(id, 'CandidateProfile');
    const profile = this.#profiles.getProfile(parsed);
    if (!profile) throw new CandidateProfileNotFoundError(id);
    return profile;
  }
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith('/') || pointer.endsWith('/') || pointer.includes('//')) {
    throw new TypeError('Path must be a canonical JSON Pointer.');
  }
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function setPointer(
  profile: CandidateProfileData,
  pointer: string,
  value: unknown,
): CandidateProfileData {
  const updated: unknown = structuredClone(profile);
  let current = updated;
  const segments = pointerSegments(pointer);
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      if (Array.isArray(current)) {
        const arrayIndex = Number(segment);
        if (!Number.isSafeInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length)
          throw new TypeError('Profile JSON Pointer does not exist.');
        current[arrayIndex] = value;
      } else if (current && typeof current === 'object' && segment in current) {
        (current as Record<string, unknown>)[segment] = value;
      } else throw new TypeError('Profile JSON Pointer does not exist.');
      return updated as CandidateProfileData;
    }
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === 'object')
      current = (current as Record<string, unknown>)[segment];
    else current = undefined;
    if (current === undefined) throw new TypeError('Profile JSON Pointer does not exist.');
  }
  throw new TypeError('Profile JSON Pointer does not exist.');
}

export class ProfileManagementService {
  readonly #profiles: CandidateProfileService;
  readonly #inspection: ProfileInspectionService;

  public constructor(input: {
    readonly profiles: CandidateProfileService;
    readonly inspection: ProfileInspectionService;
  }) {
    this.#profiles = input.profiles;
    this.#inspection = input.inspection;
  }

  public show(id: string): ProfileVersionInspection {
    const profileId = this.#profileId(id);
    const current = this.#inspection.current(profileId);
    if (!current) throw new CandidateProfileNotFoundError(id);
    return current;
  }

  public history(id: string): readonly ProfileVersionInspection[] {
    const profileId = this.#profileId(id);
    return this.#inspection.history(profileId);
  }

  public set(
    id: string,
    pointer: string,
    value: unknown,
    expectedCurrentVersionId?: string,
  ): ProfileVersionInspection {
    const profileId = this.#profileId(id);
    const current = this.#profiles.getCurrent(profileId);
    if (!current) throw new CandidateProfileNotFoundError(id);
    if (expectedCurrentVersionId && current.id !== expectedCurrentVersionId) {
      throw new ProfileVersionConflictError(current.id);
    }
    this.#profiles.applyManualCorrection({
      profileId,
      expectedCurrentVersionId: current.id,
      patch: setPointer(current.effective, pointer, value),
    });
    return this.show(id);
  }

  public replace(
    id: string,
    profile: CandidateProfileData,
    expectedCurrentVersionId: string,
  ): ProfileVersionInspection {
    const profileId = this.#profileId(id);
    const current = this.#profiles.getCurrent(profileId);
    if (!current) throw new CandidateProfileNotFoundError(id);
    if (current.id !== expectedCurrentVersionId) {
      throw new ProfileVersionConflictError(current.id);
    }
    this.#profiles.applyManualCorrection({
      profileId,
      expectedCurrentVersionId: current.id,
      patch: structuredClone(profile),
    });
    return this.show(id);
  }

  public lock(
    id: string,
    pointer: string,
    expectedCurrentVersionId?: string,
  ): ProfileVersionInspection {
    return this.#locks(id, pointer, true, expectedCurrentVersionId);
  }

  public unlock(
    id: string,
    pointer: string,
    expectedCurrentVersionId?: string,
  ): ProfileVersionInspection {
    return this.#locks(id, pointer, false, expectedCurrentVersionId);
  }

  #locks(
    id: string,
    pointer: string,
    add: boolean,
    expectedCurrentVersionId?: string,
  ): ProfileVersionInspection {
    pointerSegments(pointer);
    const profileId = this.#profileId(id);
    const current = this.#profiles.getCurrent(profileId);
    if (!current) throw new CandidateProfileNotFoundError(id);
    if (expectedCurrentVersionId && current.id !== expectedCurrentVersionId) {
      throw new ProfileVersionConflictError(current.id);
    }
    const alreadyInState = add
      ? current.lockedPaths.includes(pointer)
      : !current.lockedPaths.includes(pointer);
    if (alreadyInState) return this.show(id);
    const lockedPaths = add
      ? [...new Set([...current.lockedPaths, pointer])].toSorted()
      : current.lockedPaths.filter((path) => path !== pointer);
    this.#profiles.applyManualCorrection({
      profileId,
      expectedCurrentVersionId: current.id,
      patch: {},
      lockedPaths,
    });
    return this.show(id);
  }

  #profileId(id: string): CandidateProfileId {
    const profileId = parseId(id, 'CandidateProfile');
    if (!this.#profiles.getProfile(profileId)) throw new CandidateProfileNotFoundError(id);
    return profileId;
  }
}
