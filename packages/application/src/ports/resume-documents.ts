import type { ContentHash, UtcInstant } from '@jobhunter/domain';
import type { ResumeMediaType, ResumeParseStatus } from '@jobhunter/resume';

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

export interface ResumeDocumentRepository {
  getById(id: string): ResumeDocumentRecord | null;
  findByContentHash(contentHash: ContentHash): ResumeDocumentRecord | null;
  createOrGet(input: ResumeDocumentRecord): ResumeDocumentRecord;
}

export interface ResumeFileReader {
  read(path: string, maximumBytes: number): Promise<Uint8Array>;
}
