import type { UtcInstant } from '@jobhunter/domain';
import type { QuarantinedArtifact } from './artifact-store.js';

export interface ResumeDeletionArtifact {
  readonly id: string;
  readonly relativePath: string;
}

export interface ResumeDeletionSnapshot {
  readonly requestedResumeDocumentId: string;
  readonly profileIds: readonly string[];
  readonly profileVersionIds: readonly string[];
  readonly resumeDocumentIds: readonly string[];
  readonly matchResultIds: readonly string[];
  readonly agentRunIds: readonly string[];
  readonly artifacts: readonly ResumeDeletionArtifact[];
}

export interface ResumeDeletionRepository {
  preview(resumeDocumentId: string): ResumeDeletionSnapshot | null;
  applyConfirmedDeletion(input: {
    readonly expected: ResumeDeletionSnapshot;
    readonly quarantinedArtifacts: readonly QuarantinedArtifact[];
    readonly deletedAt: UtcInstant;
    readonly audit: {
      readonly eventKey: string;
      readonly eventType: 'resume.deleted';
      readonly subjectHash: string;
      readonly counts: Readonly<Record<string, number>>;
    };
  }): void;
  getDeletedArtifact(artifactId: string): ResumeDeletionArtifact | null;
  removePurgedArtifact(artifactId: string): void;
}
