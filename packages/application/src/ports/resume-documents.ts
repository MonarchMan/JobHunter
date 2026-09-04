import type { ContentHash, UtcInstant } from '@jobhunter/domain';
import type { ResumeMediaType, ResumeParseStatus } from '@jobhunter/resume';

/** 应用层数据结构或端口契约。 */
export interface ResumeDocumentRecord {
  readonly id: string;
  readonly artifactId: string;
  readonly contentHash: ContentHash;
  readonly mediaType: ResumeMediaType;
  readonly extractedText: string | null;
  readonly parseStatus: ResumeParseStatus;
  readonly parserVersion: string | null;
  readonly errorSummary: string | null;
  readonly createdAt: UtcInstant;
}

/** 应用层数据结构或端口契约。 */
export interface ResumeDocumentRepository {
  getById(id: string): ResumeDocumentRecord | null;
  findByContentHash(contentHash: ContentHash): ResumeDocumentRecord | null;
  createOrGet(input: ResumeDocumentRecord): ResumeDocumentRecord;
  completeOcr(input: {
    readonly id: string;
    readonly extractedText: string;
    readonly parserVersion: string;
  }): ResumeDocumentRecord;
}

/** 应用层数据结构或端口契约。 */
export interface ResumeFileReader {
  read(path: string, maximumBytes: number): Promise<Uint8Array>;
}

/** 应用层数据结构或端口契约。 */
export interface ResumeArtifactReader {
  read(artifactId: string, maximumBytes: number, signal: AbortSignal): Promise<Uint8Array>;
}
