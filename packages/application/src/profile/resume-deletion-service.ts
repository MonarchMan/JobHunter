import { hashCanonical } from '@jobhunter/agent-core';
import type { Clock } from '@jobhunter/domain';
import type { ArtifactStore, QuarantinedArtifact } from '../ports/artifact-store.js';
import type { ResumeDeletionRepository, ResumeDeletionSnapshot } from '../ports/resume-deletion.js';

export interface ResumeDeletionImpact {
  readonly impactHash: string;
  readonly snapshot: ResumeDeletionSnapshot;
  readonly counts: {
    readonly profiles: number;
    readonly profileVersions: number;
    readonly resumeDocuments: number;
    readonly matchResults: number;
    readonly agentRuns: number;
    readonly artifacts: number;
  };
}

export interface ResumeDeletionResult {
  readonly impactHash: string;
  readonly deleted: ResumeDeletionImpact['counts'];
  readonly pendingArtifactPurgeIds: readonly string[];
}

export class ResumeDeletionNotFoundError extends Error {
  public constructor() {
    super('Resume document does not exist or was already deleted.');
    this.name = 'ResumeDeletionNotFoundError';
  }
}

export class ResumeDeletionConfirmationError extends Error {
  public readonly currentImpact: ResumeDeletionImpact;

  public constructor(currentImpact: ResumeDeletionImpact) {
    super('Resume deletion impact changed; preview and confirm again.');
    this.name = 'ResumeDeletionConfirmationError';
    this.currentImpact = currentImpact;
  }
}

function impact(snapshot: ResumeDeletionSnapshot): ResumeDeletionImpact {
  return {
    impactHash: hashCanonical(snapshot),
    snapshot,
    counts: {
      profiles: snapshot.profileIds.length,
      profileVersions: snapshot.profileVersionIds.length,
      resumeDocuments: snapshot.resumeDocumentIds.length,
      matchResults: snapshot.matchResultIds.length,
      agentRuns: snapshot.agentRunIds.length,
      artifacts: snapshot.artifacts.length,
    },
  };
}

export class ResumeDeletionService {
  readonly #repository: ResumeDeletionRepository;
  readonly #artifacts: ArtifactStore;
  readonly #clock: Clock;

  public constructor(input: {
    readonly repository: ResumeDeletionRepository;
    readonly artifacts: ArtifactStore;
    readonly clock: Clock;
  }) {
    this.#repository = input.repository;
    this.#artifacts = input.artifacts;
    this.#clock = input.clock;
  }

  public preview(resumeDocumentId: string): ResumeDeletionImpact {
    const snapshot = this.#repository.preview(resumeDocumentId);
    if (!snapshot) throw new ResumeDeletionNotFoundError();
    return impact(snapshot);
  }

  public async deleteConfirmed(input: {
    readonly resumeDocumentId: string;
    readonly expectedImpactHash: string;
  }): Promise<ResumeDeletionResult> {
    const current = this.preview(input.resumeDocumentId);
    if (current.impactHash !== input.expectedImpactHash) {
      throw new ResumeDeletionConfirmationError(current);
    }
    const quarantined: QuarantinedArtifact[] = [];
    try {
      for (const artifact of current.snapshot.artifacts) {
        quarantined.push(await this.#artifacts.quarantine(artifact.id, artifact.relativePath));
      }
      this.#repository.applyConfirmedDeletion({
        expected: current.snapshot,
        quarantinedArtifacts: quarantined,
        deletedAt: this.#clock.now(),
        audit: {
          eventKey: `resume.deleted:${current.impactHash}`,
          eventType: 'resume.deleted',
          subjectHash: current.impactHash,
          counts: current.counts,
        },
      });
    } catch (error) {
      const restoreErrors: unknown[] = [];
      for (const artifact of quarantined.toReversed()) {
        try {
          await this.#artifacts.restoreQuarantined(artifact);
        } catch (restoreError) {
          restoreErrors.push(restoreError);
        }
      }
      if (restoreErrors.length > 0) {
        throw new AggregateError([error, ...restoreErrors], 'Resume deletion rollback failed.');
      }
      throw error;
    }

    const pendingArtifactPurgeIds: string[] = [];
    for (const artifact of quarantined) {
      try {
        await this.#artifacts.purgeQuarantined(artifact);
        this.#repository.removePurgedArtifact(artifact.artifactId);
      } catch {
        pendingArtifactPurgeIds.push(artifact.artifactId);
      }
    }
    return {
      impactHash: current.impactHash,
      deleted: current.counts,
      pendingArtifactPurgeIds,
    };
  }

  public async retryArtifactPurge(artifactId: string): Promise<'purged' | 'already_purged'> {
    const artifact = this.#repository.getDeletedArtifact(artifactId);
    if (!artifact) return 'already_purged';
    await this.#artifacts.purgeQuarantined({
      artifactId: artifact.id,
      originalRelativePath: artifact.relativePath,
      quarantinedRelativePath: artifact.relativePath,
      fileExisted: true,
    });
    this.#repository.removePurgedArtifact(artifact.id);
    return 'purged';
  }
}
