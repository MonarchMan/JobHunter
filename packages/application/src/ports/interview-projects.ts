import type {
  AgentRunId,
  CandidateProfileId,
  CandidateProject,
  ContentHash,
  DrillAnswerRevisionId,
  DrillCoverageDimension,
  DrillCoverageStatus,
  DrillEvidenceRef,
  DrillSessionId,
  DrillSessionStatus,
  DrillTurnId,
  DrillTurnStatus,
  ProfileVersionId,
  ProjectDossierId,
  ProjectKnowledgeItemId,
  ProjectKnowledgeKind,
  ProjectMaterialChunkId,
  ResumeProjectSnapshotId,
  TaskId,
  UtcInstant,
} from '@jobhunter/domain';
import type { QuarantinedArtifact } from './artifact-store.js';

/** 应用层数据结构或端口契约。 */
export interface ResumeProjectSnapshotRecord {
  readonly id: ResumeProjectSnapshotId;
  readonly sourceProfileId: CandidateProfileId;
  readonly sourceProfileVersionId: ProfileVersionId;
  readonly projectIndex: number;
  readonly project: CandidateProject;
  readonly contentHash: ContentHash;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectDossierRecord {
  readonly id: ProjectDossierId;
  readonly snapshotId: ResumeProjectSnapshotId;
  readonly latestNotebookArtifactId: string | null;
  readonly notebookSourceHash: ContentHash | null;
  readonly revision: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface DrillSessionRecord {
  readonly id: DrillSessionId;
  readonly dossierId: ProjectDossierId;
  readonly profileKey: 'resume-only' | 'docs-grounded';
  readonly profileVersion: 'v1';
  readonly profileDefinitionHash: ContentHash;
  readonly capabilitySummary: Readonly<{
    evidenceKinds: readonly (
      'resume_project' | 'user_answer' | 'derived_claim' | 'project_material'
    )[];
    tools: readonly string[];
  }>;
  readonly materialBindings: readonly ProjectMaterialBinding[];
  readonly status: DrillSessionStatus;
  readonly contextRevision: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
  readonly completedAt: UtcInstant | null;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectMaterialChunkRecord {
  readonly id: ProjectMaterialChunkId;
  readonly heading: string | null;
  readonly start: number;
  readonly end: number;
  readonly contentHash: ContentHash;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectMaterialBinding {
  readonly fileId: string;
  readonly entityId: string;
  readonly versionNo: number;
  readonly fileName: string;
  readonly contentHash: ContentHash;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectMaterialRecord extends ProjectMaterialBinding {
  readonly dossierId: ProjectDossierId;
  readonly mediaType: 'text/markdown; charset=utf-8';
  readonly byteSize: number;
  readonly chunks: readonly ProjectMaterialChunkRecord[];
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectMaterialContext extends ProjectMaterialRecord {
  readonly chunks: readonly (ProjectMaterialChunkRecord & { readonly text: string })[];
}

/** 应用层数据结构或端口契约。 */
export interface DrillTurnRecord {
  readonly id: DrillTurnId;
  readonly sessionId: DrillSessionId;
  readonly turnNo: number;
  readonly status: DrillTurnStatus;
  readonly contextHash: ContentHash;
  readonly question: string | null;
  readonly intent: string | null;
  readonly primaryDimension: DrillCoverageDimension | null;
  readonly guidanceSlots: readonly string[];
  readonly evidenceRefs: readonly DrillEvidenceRef[];
  readonly questionTaskId: TaskId | null;
  readonly questionAgentRunId: AgentRunId | null;
  readonly digestTaskId: TaskId | null;
  readonly digestAgentRunId: AgentRunId | null;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface DrillAnswerRevisionRecord {
  readonly id: DrillAnswerRevisionId;
  readonly turnId: DrillTurnId;
  readonly revisionNo: number;
  readonly answer: string;
  readonly contentHash: ContentHash;
  readonly idempotencyKey: string;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectKnowledgeItemRecord {
  readonly id: ProjectKnowledgeItemId;
  readonly dossierId: ProjectDossierId;
  readonly sourceAnswerRevisionId: DrillAnswerRevisionId;
  readonly kind: ProjectKnowledgeKind;
  readonly statement: string;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly status: 'active' | 'superseded';
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface DrillCoverageRecord {
  readonly sessionId: DrillSessionId;
  readonly dimension: DrillCoverageDimension;
  readonly status: DrillCoverageStatus;
  readonly evidenceItemIds: readonly ProjectKnowledgeItemId[];
  readonly updatedAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectDossierSummary {
  readonly dossier: ProjectDossierRecord;
  readonly snapshot: ResumeProjectSnapshotRecord;
  readonly sourceAvailable: boolean;
  readonly sessions: number;
  readonly activeSessionId: DrillSessionId | null;
}

/** 应用层数据结构或端口契约。 */
export interface ProjectDossierDetail extends ProjectDossierSummary {
  readonly sessionRecords: readonly DrillSessionRecord[];
  readonly turns: readonly DrillTurnRecord[];
  readonly answers: readonly DrillAnswerRevisionRecord[];
  readonly knowledgeItems: readonly ProjectKnowledgeItemRecord[];
  readonly coverage: readonly DrillCoverageRecord[];
  readonly materials: readonly ProjectMaterialRecord[];
}

/** 应用层数据结构或端口契约。 */
export interface ProjectQuestionContext {
  readonly dossier: ProjectDossierRecord;
  readonly snapshot: ResumeProjectSnapshotRecord;
  readonly session: DrillSessionRecord;
  readonly turn: DrillTurnRecord;
  readonly history: readonly {
    readonly turnId: DrillTurnId;
    readonly question: string;
    readonly answerRevisionId: DrillAnswerRevisionId;
    readonly answer: string;
  }[];
  readonly knowledgeItems: readonly ProjectKnowledgeItemRecord[];
  readonly coverage: readonly DrillCoverageRecord[];
  readonly materials: readonly ProjectMaterialContext[];
}

/** 应用层数据结构或端口契约。 */
export interface ProjectAnswerContext {
  readonly dossier: ProjectDossierRecord;
  readonly snapshot: ResumeProjectSnapshotRecord;
  readonly session: DrillSessionRecord;
  readonly turn: DrillTurnRecord;
  readonly answerRevision: DrillAnswerRevisionRecord;
}

/** 应用层数据结构或端口契约。 */
export interface DossierDeletionArtifact {
  readonly id: string;
  readonly relativePath: string;
  readonly shared: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface DossierDeletionSnapshot {
  readonly dossierId: ProjectDossierId;
  readonly dossierRevision: number;
  readonly snapshotId: ResumeProjectSnapshotId;
  readonly sessionIds: readonly DrillSessionId[];
  readonly turnIds: readonly DrillTurnId[];
  readonly answerRevisionIds: readonly DrillAnswerRevisionId[];
  readonly knowledgeItemIds: readonly ProjectKnowledgeItemId[];
  readonly notebookArtifactId: string | null;
  readonly notebookRelativePath: string | null;
  readonly notebookShared: boolean;
  readonly materialFileIds: readonly string[];
  readonly materialArtifacts: readonly DossierDeletionArtifact[];
}

/** 应用层数据结构或端口契约。 */
export interface ProjectNotebookReader {
  read(
    artifactId: string,
    maximumBytes: number,
    signal: AbortSignal,
  ): Promise<{ readonly content: Uint8Array; readonly mediaType: string }>;
}

/** 应用层数据结构或端口契约。 */
export interface InterviewProjectRepository {
  createDossier(input: {
    readonly dossier: ProjectDossierRecord;
    readonly snapshot: ResumeProjectSnapshotRecord;
  }): { readonly dossier: ProjectDossierRecord; readonly deduplicated: boolean };
  listDossiers(): readonly ProjectDossierSummary[];
  getDossier(id: ProjectDossierId): ProjectDossierDetail | null;
  findMaterialByName(dossierId: ProjectDossierId, fileName: string): ProjectMaterialRecord | null;
  claimMaterialFile(input: {
    readonly dossierId: ProjectDossierId;
    readonly fileName: string;
    readonly proposedFileId: string;
    readonly now: UtcInstant;
  }): string;
  registerMaterial(input: {
    readonly dossierId: ProjectDossierId;
    readonly fileId: string;
    readonly entityId: string;
    readonly fileName: string;
    readonly normalizedText: string;
    readonly parserVersion: string;
    readonly chunks: readonly ProjectMaterialChunkRecord[];
    readonly now: UtcInstant;
  }): { readonly material: ProjectMaterialRecord; readonly deduplicated: boolean };
  resolveMaterialBindings(
    dossierId: ProjectDossierId,
    fileIds: readonly string[],
  ): readonly ProjectMaterialBinding[];
  createSession(input: {
    readonly session: DrillSessionRecord;
    readonly coverage: readonly DrillCoverageRecord[];
  }): DrillSessionRecord;
  getSession(id: DrillSessionId): DrillSessionRecord | null;
  updateSessionStatus(input: {
    readonly id: DrillSessionId;
    readonly expectedStatus: DrillSessionStatus;
    readonly status: DrillSessionStatus;
    readonly now: UtcInstant;
  }): DrillSessionRecord | null;
  createQuestionTurn(input: {
    readonly turn: DrillTurnRecord;
    readonly expectedSessionRevision: number;
  }): DrillTurnRecord;
  attachQuestionTask(input: {
    readonly turnId: DrillTurnId;
    readonly taskId: TaskId;
    readonly now: UtcInstant;
  }): void;
  removeUnqueuedQuestionTurn(turnId: DrillTurnId): void;
  getQuestionContext(turnId: DrillTurnId): ProjectQuestionContext | null;
  completeQuestion(input: {
    readonly turnId: DrillTurnId;
    readonly expectedTaskId?: TaskId;
    readonly expectedContextHash: ContentHash;
    readonly expectedSessionRevision: number;
    readonly question: string;
    readonly intent: string;
    readonly primaryDimension: DrillCoverageDimension;
    readonly guidanceSlots: readonly string[];
    readonly evidenceRefs: readonly DrillEvidenceRef[];
    readonly agentRunId: AgentRunId;
    readonly now: UtcInstant;
  }): boolean;
  appendAnswer(input: {
    readonly sessionId: DrillSessionId;
    readonly turnId: DrillTurnId;
    readonly answer: DrillAnswerRevisionRecord;
    readonly expectedSessionRevision: number;
    readonly now: UtcInstant;
  }): { readonly answer: DrillAnswerRevisionRecord; readonly deduplicated: boolean };
  attachDigestTask(input: {
    readonly turnId: DrillTurnId;
    readonly taskId: TaskId;
    readonly now: UtcInstant;
  }): void;
  getAnswerContext(
    turnId: DrillTurnId,
    answerRevisionId: DrillAnswerRevisionId,
  ): ProjectAnswerContext | null;
  completeAnswerDigest(input: {
    readonly turnId: DrillTurnId;
    readonly expectedTaskId?: TaskId;
    readonly answerRevisionId: DrillAnswerRevisionId;
    readonly expectedSessionRevision: number;
    readonly agentRunId: AgentRunId;
    readonly knowledgeItems: readonly ProjectKnowledgeItemRecord[];
    readonly coverage: readonly DrillCoverageRecord[];
    readonly now: UtcInstant;
  }): boolean;
  skipTurn(input: { readonly turnId: DrillTurnId; readonly now: UtcInstant }): DrillTurnRecord;
  cancelPendingTurn(input: {
    readonly turnId: DrillTurnId;
    readonly now: UtcInstant;
  }): DrillTurnRecord;
  updateNotebook(input: {
    readonly dossierId: ProjectDossierId;
    readonly expectedRevision: number;
    readonly expectedTaskId?: TaskId;
    readonly artifactId: string;
    readonly sourceHash: ContentHash;
    readonly now: UtcInstant;
  }): boolean;
  discardNotebookArtifact(artifactId: string): void;
  previewDeletion(dossierId: ProjectDossierId): DossierDeletionSnapshot | null;
  deleteDossier(input: {
    readonly expected: DossierDeletionSnapshot;
    readonly quarantinedArtifacts: readonly QuarantinedArtifact[];
    readonly deletedAt: UtcInstant;
  }): boolean;
  removePurgedArtifact(artifactId: string): void;
}
