import type { Clock, IdGenerator } from '@jobhunter/domain';
import { detectResumeMediaType, parseResumeText } from '@jobhunter/resume';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { ResumeDocumentRecord, ResumeDocumentRepository } from '../ports/resume-documents.js';

export interface ResumeImportResult {
  readonly document: ResumeDocumentRecord;
  readonly deduplicated: boolean;
}

export interface ResumeImportServiceOptions {
  readonly maximumFileBytes?: number;
  readonly minimumNonWhitespaceCharacters?: number;
  readonly maximumExtractedCharacters?: number;
}

export class ResumeImportService {
  readonly #artifacts: ArtifactStore;
  readonly #documents: ResumeDocumentRepository;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #options: Required<ResumeImportServiceOptions>;

  public constructor(input: {
    readonly artifacts: ArtifactStore;
    readonly documents: ResumeDocumentRepository;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly options?: ResumeImportServiceOptions;
  }) {
    this.#artifacts = input.artifacts;
    this.#documents = input.documents;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#options = {
      maximumFileBytes: input.options?.maximumFileBytes ?? 10 * 1024 * 1024,
      minimumNonWhitespaceCharacters: input.options?.minimumNonWhitespaceCharacters ?? 80,
      maximumExtractedCharacters: input.options?.maximumExtractedCharacters ?? 250_000,
    };
  }

  public async import(bytes: Uint8Array, signal: AbortSignal): Promise<ResumeImportResult> {
    if (signal.aborted) throw new DOMException('Resume import was aborted.', 'AbortError');
    const detected = detectResumeMediaType(bytes, this.#options.maximumFileBytes);
    const createdAt = this.#clock.now();
    const artifact = await this.#artifacts.put({
      id: this.#ids.generate(),
      kind: 'resume',
      mediaType: detected.mediaType,
      content: bytes,
      createdAt,
    });
    const existing = this.#documents.findByContentHash(artifact.sha256);
    if (existing) return { document: existing, deduplicated: true };

    const parsed = await parseResumeText(bytes, detected.mediaType, {
      minimumNonWhitespaceCharacters: this.#options.minimumNonWhitespaceCharacters,
      maximumExtractedCharacters: this.#options.maximumExtractedCharacters,
      signal,
    });
    const candidate: ResumeDocumentRecord = {
      id: this.#ids.generate(),
      artifactId: artifact.id,
      contentHash: artifact.sha256,
      mediaType: detected.mediaType,
      extractedText: parsed.text,
      parseStatus: parsed.status,
      parserVersion: parsed.parserVersion,
      errorSummary: parsed.errorSummary,
      createdAt,
    };
    const document = this.#documents.createOrGet(candidate);
    return { document, deduplicated: document.id !== candidate.id };
  }
}
