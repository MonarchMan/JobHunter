import type { ContentHash, UtcInstant } from '@jobhunter/domain';

export type ArtifactKind =
  | 'resume'
  | 'interview_experience'
  | 'project_material'
  | 'project_notebook'
  | 'interview_research'
  | 'export'
  | 'resume_avatar'
  | 'fixture_candidate';

export interface StoredArtifact {
  readonly id: string;
  readonly entityId: string;
  readonly versionNo: number;
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

export interface StoredArtifactContent {
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly sha256: ContentHash;
}

export interface ArtifactStore {
  put(input: {
    readonly id: string;
    readonly kind: ArtifactKind;
    readonly name?: string;
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly createdAt: UtcInstant;
    /** `new` preserves the requested logical file id while still deduplicating the physical entity. */
    readonly logicalFile?: 'reuse' | 'new';
  }): Promise<StoredArtifact>;
  read(input: {
    readonly id: string;
    readonly versionNo: number;
    readonly kind: ArtifactKind;
    readonly maximumBytes: number;
    readonly signal?: AbortSignal;
  }): Promise<StoredArtifactContent>;
  remove(input: { readonly id: string; readonly kind: ArtifactKind }): Promise<void>;
  resolve(relativePath: string): string;
  quarantine(artifactId: string, relativePath: string): Promise<QuarantinedArtifact>;
  restoreQuarantined(artifact: QuarantinedArtifact): Promise<void>;
  purgeQuarantined(artifact: QuarantinedArtifact): Promise<void>;
}
