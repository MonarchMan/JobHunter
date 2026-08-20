import type { ContentHash, UtcInstant } from '@jobhunter/domain';

export type ArtifactKind = 'raw_job' | 'resume' | 'export' | 'fixture_candidate';

export interface StoredArtifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly sha256: ContentHash;
  readonly byteSize: number;
  readonly createdAt: UtcInstant;
}

export interface QuarantinedArtifact {
  readonly artifactId: string;
  readonly originalRelativePath: string;
  readonly quarantinedRelativePath: string;
  readonly fileExisted: boolean;
}

export interface ArtifactStore {
  put(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly createdAt: UtcInstant;
  }): Promise<StoredArtifact>;
  resolve(relativePath: string): string;
  quarantine(artifactId: string, relativePath: string): Promise<QuarantinedArtifact>;
  restoreQuarantined(artifact: QuarantinedArtifact): Promise<void>;
  purgeQuarantined(artifact: QuarantinedArtifact): Promise<void>;
}
