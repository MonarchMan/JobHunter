import type {
  ContentHash,
  ExperienceDocumentId,
  ExperienceDocumentStatus,
  ExperienceSourceMode,
  ExperienceWarningCode,
  InterviewExperienceDraft,
  InterviewExperienceId,
  InterviewQuestionEntryId,
  UtcInstant,
} from '@jobhunter/domain';
import type { QuarantinedArtifact } from './artifact-store.js';

/** 应用层数据结构或端口契约。 */
export interface ExperienceDocumentRecord {
  readonly id: ExperienceDocumentId;
  readonly artifactId: string;
  readonly contentHash: ContentHash;
  readonly fileName: string;
  readonly mediaType: string;
  readonly sourceMode: ExperienceSourceMode;
  readonly extractedText: string;
  readonly normalizedText: string;
  readonly parserVersion: string;
  readonly templateVersion: string | null;
  readonly status: ExperienceDocumentStatus;
  readonly warnings: readonly ExperienceWarningCode[];
  readonly revision: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
  readonly acceptedAt: UtcInstant | null;
}

/** 应用层数据结构或端口契约。 */
export interface InterviewExperienceRecord extends InterviewExperienceDraft {
  readonly id: InterviewExperienceId;
  readonly documentId: ExperienceDocumentId;
}

/** 应用层数据结构或端口契约。 */
export interface InterviewQuestionEntryRecord {
  readonly id: InterviewQuestionEntryId;
  readonly experienceId: InterviewExperienceId;
  readonly sequenceNo: number;
  readonly question: string;
  readonly answer: string | null;
  readonly reflection: string | null;
  readonly questionEvidence: { readonly start: number; readonly end: number } | null;
  readonly answerEvidence: { readonly start: number; readonly end: number } | null;
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceDocumentDetail {
  readonly document: ExperienceDocumentRecord;
  readonly experiences: readonly InterviewExperienceRecord[];
  readonly questions: readonly InterviewQuestionEntryRecord[];
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceDocumentSummary {
  readonly document: ExperienceDocumentRecord;
  readonly company: string | null;
  readonly role: string | null;
  readonly stage: string | null;
  readonly occurredOn: string | null;
  readonly experienceCount: number;
  readonly questionCount: number;
  readonly unansweredCount: number;
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceDeletionSnapshot {
  readonly documentId: ExperienceDocumentId;
  readonly documentRevision: number;
  readonly experienceIds: readonly InterviewExperienceId[];
  readonly questionIds: readonly InterviewQuestionEntryId[];
  readonly artifactId: string;
  readonly artifactRelativePath: string | null;
  readonly artifactShared: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface InterviewExperienceRepository {
  findByContentHash(
    contentHash: ContentHash,
    parserVersion: string,
  ): ExperienceDocumentDetail | null;
  createDraft(input: {
    readonly document: ExperienceDocumentRecord;
    readonly experiences: readonly InterviewExperienceRecord[];
    readonly questions: readonly InterviewQuestionEntryRecord[];
  }): { readonly detail: ExperienceDocumentDetail; readonly deduplicated: boolean };
  list(): readonly ExperienceDocumentSummary[];
  get(id: ExperienceDocumentId): ExperienceDocumentDetail | null;
  replaceDraft(input: {
    readonly documentId: ExperienceDocumentId;
    readonly expectedRevision: number;
    readonly warnings: readonly ExperienceWarningCode[];
    readonly experiences: readonly InterviewExperienceRecord[];
    readonly questions: readonly InterviewQuestionEntryRecord[];
    readonly now: UtcInstant;
  }): ExperienceDocumentDetail | null;
  accept(input: {
    readonly documentId: ExperienceDocumentId;
    readonly expectedRevision: number;
    readonly now: UtcInstant;
  }): ExperienceDocumentDetail | null;
  previewDeletion(documentId: ExperienceDocumentId): ExperienceDeletionSnapshot | null;
  deleteDocument(input: {
    readonly expected: ExperienceDeletionSnapshot;
    readonly quarantinedArtifact: QuarantinedArtifact | null;
    readonly deletedAt: UtcInstant;
  }): boolean;
  removePurgedArtifact(artifactId: string): void;
}
