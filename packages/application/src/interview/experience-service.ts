import { hashCanonical } from '@jobhunter/agent-core';
import {
  assertExperienceDraftCanBeAccepted,
  experienceWarnings,
  interviewExperienceDraftSchema,
  parseContentHash,
  parseId,
  parsePersonalExperienceText,
  personalExperienceParserVersion,
  personalExperienceTemplateVersion,
  type Clock,
  type ExperienceDocumentId,
  type IdGenerator,
  type InterviewExperienceDraft,
} from '@jobhunter/domain';
import { detectResumeMediaType, parseResumeText, type ResumeMediaType } from '@jobhunter/resume';
import type { ArtifactStore, QuarantinedArtifact } from '../ports/artifact-store.js';
import type {
  ExperienceDeletionSnapshot,
  ExperienceDocumentDetail,
  ExperienceDocumentRecord,
  ExperienceDocumentSummary,
  InterviewExperienceRecord,
  InterviewExperienceRepository,
  InterviewQuestionEntryRecord,
} from '../ports/interview-experiences.js';
import {
  personalExperienceTemplateFileName,
  personalExperienceTemplateMarkdown,
  renderPersonalExperienceMarkdown,
} from './experience-template.js';

/** 请求的个人面经文档不存在。 */
export class ExperienceDocumentNotFoundError extends Error {
  public constructor() {
    super('Interview experience document does not exist.');
    this.name = 'ExperienceDocumentNotFoundError';
  }
}

/** 文档版本或状态已变化，拒绝覆盖其他操作的结果。 */
export class ExperienceDocumentConflictError extends Error {
  public constructor(message = 'Interview experience document changed.') {
    super(message);
    this.name = 'ExperienceDocumentConflictError';
  }
}

/** 上传文件无法解码、解析或不符合模板边界。 */
export class ExperienceDocumentParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExperienceDocumentParseError';
  }
}

/** 应用层数据结构或端口契约。 */
export interface ExperienceDeletionImpact {
  readonly impactHash: string;
  readonly snapshot: ExperienceDeletionSnapshot;
  readonly counts: {
    readonly experiences: number;
    readonly questions: number;
    readonly artifacts: number;
  };
}

/** 规范化上传文件名并拒绝空名或过长名称。 */
function safeFileName(value: string): string {
  const fileName = value.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  if (!fileName || fileName.length > 255) throw new TypeError('Experience file name is invalid.');
  return fileName;
}

/** 根据模板标记识别文档版本，未知格式仍允许进入草稿解析。 */
function detectTemplate(text: string): typeof personalExperienceTemplateVersion | null {
  return text.includes(`模板版本：${personalExperienceTemplateVersion}`)
    ? personalExperienceTemplateVersion
    : null;
}

/** 为经历和问题补齐稳定序号并运行领域 Schema 校验。 */
function normalizeDrafts(
  drafts: readonly InterviewExperienceDraft[],
): readonly InterviewExperienceDraft[] {
  return drafts.map((draft, experienceIndex) =>
    interviewExperienceDraftSchema.parse({
      ...draft,
      sequenceNo: experienceIndex + 1,
      questions: draft.questions.map((question, questionIndex) => ({
        ...question,
        sequenceNo: questionIndex + 1,
      })),
    }),
  );
}

/** 校验证据字符范围，防止引用越界。 */
function validateRange(
  text: string,
  range: { readonly start: number; readonly end: number } | null,
): void {
  if (!range) return;
  if (range.start < 0 || range.end <= range.start || range.end > text.length) {
    throw new TypeError('Experience evidence range is invalid.');
  }
}

/** 校验所有问答证据范围都落在原始提取文本内。 */
function validateEvidence(text: string, drafts: readonly InterviewExperienceDraft[]): void {
  drafts.forEach((draft) => {
    draft.questions.forEach((question) => {
      validateRange(text, question.questionEvidence);
      validateRange(text, question.answerEvidence);
    });
  });
}

/** 将删除快照转换为可供确认的影响摘要和哈希。 */
function deletionImpact(snapshot: ExperienceDeletionSnapshot): ExperienceDeletionImpact {
  return {
    impactHash: hashCanonical(snapshot),
    snapshot,
    counts: {
      experiences: snapshot.experienceIds.length,
      questions: snapshot.questionIds.length,
      artifacts: snapshot.artifactShared ? 0 : 1,
    },
  };
}

/** 编排个人面经导入、规范化、审核确认和版本删除。 */
export class InterviewExperienceService {
  readonly #repository: InterviewExperienceRepository;
  readonly #artifacts: ArtifactStore;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #maximumFileBytes: number;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly repository: InterviewExperienceRepository;
    readonly artifacts: ArtifactStore;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly maximumFileBytes?: number;
  }) {
    this.#repository = input.repository;
    this.#artifacts = input.artifacts;
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#maximumFileBytes = input.maximumFileBytes ?? 10 * 1024 * 1024;
  }

  /** 返回标准模板文本，供下载或在线编辑器初始化。 */
  public template(): {
    readonly version: typeof personalExperienceTemplateVersion;
    readonly fileName: string;
    readonly mediaType: 'text/markdown; charset=utf-8';
    readonly markdown: string;
  } {
    return {
      version: personalExperienceTemplateVersion,
      fileName: personalExperienceTemplateFileName,
      mediaType: 'text/markdown; charset=utf-8',
      markdown: personalExperienceTemplateMarkdown,
    };
  }

  /** 列出个人面经文档摘要。 */
  public list(): readonly ExperienceDocumentSummary[] {
    return this.#repository.list();
  }

  /** 按 ID 获取文档及其结构化问答详情。 */
  public get(idValue: string): ExperienceDocumentDetail {
    const detail = this.#repository.get(parseId(idValue, 'ExperienceDocument'));
    if (!detail) throw new ExperienceDocumentNotFoundError();
    return detail;
  }

  /** 导入个人面经文件并生成草稿；同内容同解析器时直接去重。 */
  public async importFile(input: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly sourceMode?: 'upload' | 'online';
    readonly signal: AbortSignal;
  }): Promise<{ readonly detail: ExperienceDocumentDetail; readonly deduplicated: boolean }> {
    // 1、识别媒体类型并提取文字；2、规范化问答；3、保存原文件与解析结果；4、按内容哈希去重。
    if (input.signal.aborted)
      throw new DOMException('Experience import was aborted.', 'AbortError');
    const fileName = safeFileName(input.fileName);
    const detected = detectResumeMediaType(input.bytes, this.#maximumFileBytes);
    if (detected.mediaType === 'image/jpeg' || detected.mediaType === 'image/png') {
      throw new ExperienceDocumentParseError(
        '个人面经首版暂不支持图片，请使用 Markdown、TXT、PDF 或 DOCX。',
      );
    }
    const parsedText = await parseResumeText(input.bytes, detected.mediaType, {
      minimumNonWhitespaceCharacters: 1,
      maximumExtractedCharacters: 250_000,
      signal: input.signal,
    });
    if (parsedText.status !== 'parsed' || !parsedText.text) {
      throw new ExperienceDocumentParseError(
        parsedText.status === 'needs_ocr'
          ? '文档没有足够的可读取文字，请改用 Markdown、TXT 或可复制文字的 PDF/DOCX。'
          : '无法读取面经文档文字，请检查文件内容和编码。',
      );
    }
    const parserVersion = `${personalExperienceParserVersion}+${parsedText.parserVersion}`;
    const parsed = parsePersonalExperienceText(parsedText.text);
    const now = this.#clock.now();
    const artifact = await this.#artifacts.put({
      id: this.#ids.generate(),
      kind: 'interview_experience',
      name: fileName,
      mediaType: detected.mediaType,
      content: input.bytes,
      createdAt: now,
    });
    const existing = this.#repository.findByContentHash(artifact.sha256, parserVersion);
    if (existing) return { detail: existing, deduplicated: true };
    const documentId = parseId(artifact.id, 'ExperienceDocument');
    const records = this.#records(documentId, parsed.experiences);
    const document: ExperienceDocumentRecord = {
      id: documentId,
      artifactId: artifact.entityId,
      contentHash: parseContentHash(artifact.sha256),
      fileName,
      mediaType: detected.mediaType,
      sourceMode: input.sourceMode ?? 'upload',
      extractedText: parsedText.text,
      normalizedText: parsed.normalizedText,
      parserVersion,
      templateVersion: detectTemplate(parsed.normalizedText),
      status: 'draft',
      warnings: parsed.warnings,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      acceptedAt: null,
    };
    return this.#repository.createDraft({ document, ...records });
  }

  /** 将在线填写的草稿渲染成标准 Markdown，再走统一导入链路。 */
  public async createOnline(
    draft: InterviewExperienceDraft,
    signal: AbortSignal,
  ): Promise<{ readonly detail: ExperienceDocumentDetail; readonly deduplicated: boolean }> {
    const normalized = normalizeDrafts([{ ...draft, sequenceNo: 1 }])[0];
    if (!normalized) throw new TypeError('Online experience is invalid.');
    const markdown = renderPersonalExperienceMarkdown(normalized);
    return this.importFile({
      bytes: new TextEncoder().encode(markdown),
      fileName: 'online-interview-experience.md',
      sourceMode: 'online',
      signal,
    });
  }

  /** 在乐观锁校验后替换尚未确认的文档草稿。 */
  public replaceDraft(input: {
    readonly documentId: string;
    readonly expectedRevision: number;
    readonly experiences: readonly InterviewExperienceDraft[];
  }): ExperienceDocumentDetail {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new TypeError('Experience revision is invalid.');
    }
    const documentId = parseId(input.documentId, 'ExperienceDocument');
    const current = this.#repository.get(documentId);
    if (!current) throw new ExperienceDocumentNotFoundError();
    if (current.document.status !== 'draft') {
      throw new ExperienceDocumentConflictError('Accepted interview history is read-only.');
    }
    const drafts = normalizeDrafts(input.experiences);
    validateEvidence(current.document.normalizedText, drafts);
    const records = this.#records(documentId, drafts);
    const replaced = this.#repository.replaceDraft({
      documentId,
      expectedRevision: input.expectedRevision,
      warnings: experienceWarnings(drafts),
      ...records,
      now: this.#clock.now(),
    });
    if (!replaced) throw new ExperienceDocumentConflictError();
    return replaced;
  }

  /** 确认草稿，使其进入历史面经可检索状态。 */
  public accept(input: {
    readonly documentId: string;
    readonly expectedRevision: number;
  }): ExperienceDocumentDetail {
    const detail = this.get(input.documentId);
    const drafts = this.#drafts(detail);
    assertExperienceDraftCanBeAccepted(drafts);
    const accepted = this.#repository.accept({
      documentId: detail.document.id,
      expectedRevision: input.expectedRevision,
      now: this.#clock.now(),
    });
    if (!accepted) throw new ExperienceDocumentConflictError();
    return accepted;
  }

  /** 预览删除影响，要求调用方随后携带影响哈希确认。 */
  public previewDeletion(documentIdValue: string): ExperienceDeletionImpact {
    const snapshot = this.#repository.previewDeletion(
      parseId(documentIdValue, 'ExperienceDocument'),
    );
    if (!snapshot) throw new ExperienceDocumentNotFoundError();
    return deletionImpact(snapshot);
  }

  /** 按影响哈希删除文档及其不共享的物理文件。 */
  public async deleteConfirmed(input: {
    // 1、重新计算删除影响；2、校验确认哈希；3、删除结构化记录；4、清理独占物理文件。
    readonly documentId: string;
    readonly expectedImpactHash: string;
  }): Promise<{ readonly impactHash: string; readonly pendingArtifactPurgeId: string | null }> {
    const current = this.previewDeletion(input.documentId);
    if (current.impactHash !== input.expectedImpactHash) {
      throw new ExperienceDocumentConflictError('Experience deletion impact changed.');
    }
    let quarantined: QuarantinedArtifact | null = null;
    if (!current.snapshot.artifactShared && current.snapshot.artifactRelativePath) {
      quarantined = await this.#artifacts.quarantine(
        current.snapshot.artifactId,
        current.snapshot.artifactRelativePath,
      );
    }
    try {
      if (
        !this.#repository.deleteDocument({
          expected: current.snapshot,
          quarantinedArtifact: quarantined,
          deletedAt: this.#clock.now(),
        })
      ) {
        throw new ExperienceDocumentConflictError('Experience deletion impact changed.');
      }
    } catch (error) {
      if (quarantined) await this.#artifacts.restoreQuarantined(quarantined);
      throw error;
    }
    if (quarantined) {
      try {
        await this.#artifacts.purgeQuarantined(quarantined);
        this.#repository.removePurgedArtifact(quarantined.artifactId);
      } catch {
        return { impactHash: current.impactHash, pendingArtifactPurgeId: quarantined.artifactId };
      }
    }
    return { impactHash: current.impactHash, pendingArtifactPurgeId: null };
  }

  /** 将解析出的草稿转换为仓储可写入的经历和问题记录。 */
  #records(
    documentId: ExperienceDocumentId,
    drafts: readonly InterviewExperienceDraft[],
  ): {
    readonly experiences: readonly InterviewExperienceRecord[];
    readonly questions: readonly InterviewQuestionEntryRecord[];
  } {
    const experiences: InterviewExperienceRecord[] = [];
    const questions: InterviewQuestionEntryRecord[] = [];
    drafts.forEach((draft) => {
      const experienceId = parseId(this.#ids.generate(), 'InterviewExperience');
      experiences.push({ ...draft, questions: [], id: experienceId, documentId });
      draft.questions.forEach((question) => {
        questions.push({
          ...question,
          id: parseId(this.#ids.generate(), 'InterviewQuestionEntry'),
          experienceId,
        });
      });
    });
    return { experiences, questions };
  }

  /** 从详情记录还原领域草稿，供替换和确认流程复用。 */
  #drafts(detail: ExperienceDocumentDetail): readonly InterviewExperienceDraft[] {
    return detail.experiences.map((experience) => ({
      ...experience,
      questions: detail.questions
        .filter((question) => question.experienceId === experience.id)
        .map((question) => ({
          sequenceNo: question.sequenceNo,
          question: question.question,
          answer: question.answer,
          reflection: question.reflection,
          questionEvidence: question.questionEvidence,
          answerEvidence: question.answerEvidence,
        })),
    }));
  }
}

/** 应用层使用的类型约束。 */
export type SupportedExperienceMediaType = Exclude<ResumeMediaType, 'image/jpeg' | 'image/png'>;
