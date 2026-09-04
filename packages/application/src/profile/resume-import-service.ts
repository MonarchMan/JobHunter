import type { Clock, IdGenerator } from '@jobhunter/domain';
import { detectResumeMediaType, parseResumeText } from '@jobhunter/resume';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { ResumeDocumentRecord, ResumeDocumentRepository } from '../ports/resume-documents.js';

/** 应用层数据结构或端口契约。 */
export interface ResumeImportResult {
  readonly document: ResumeDocumentRecord;
  readonly deduplicated: boolean;
}

/** 应用层数据结构或端口契约。 */
export interface ResumeImportServiceOptions {
  readonly maximumFileBytes?: number;
  readonly minimumNonWhitespaceCharacters?: number;
  readonly maximumExtractedCharacters?: number;
}

/** 保存简历物理文件、提取文本并创建可供画像任务消费的文档记录。 */
export class ResumeImportService {
  readonly #artifacts: ArtifactStore;
  readonly #documents: ResumeDocumentRepository;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #options: Required<ResumeImportServiceOptions>;

  /** 执行应用组件对外暴露的操作。 */
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

  /** 执行应用组件对外暴露的操作。 */
  public async import(bytes: Uint8Array, signal: AbortSignal): Promise<ResumeImportResult> {
    // 1、校验媒体类型并保存不可变文件实体，内容哈希用于幂等去重。
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

    // 2、在数据库事务外解析和清洗文本，避免阻塞 SQLite 事务。
    const parsed = await parseResumeText(bytes, detected.mediaType, {
      minimumNonWhitespaceCharacters: this.#options.minimumNonWhitespaceCharacters,
      maximumExtractedCharacters: this.#options.maximumExtractedCharacters,
      signal,
    });
    const candidate: ResumeDocumentRecord = {
      id: artifact.id,
      artifactId: artifact.entityId,
      contentHash: artifact.sha256,
      mediaType: detected.mediaType,
      extractedText: parsed.text,
      parseStatus: parsed.status,
      parserVersion: parsed.parserVersion,
      errorSummary: parsed.errorSummary,
      createdAt,
    };
    // 3、仅登记解析结果，不在导入请求内直接调用模型；画像由后续任务处理。
    const document = this.#documents.createOrGet(candidate);
    return { document, deduplicated: document.id !== candidate.id };
  }
}
