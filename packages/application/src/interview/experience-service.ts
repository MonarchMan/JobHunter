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

export class ExperienceDocumentNotFoundError extends Error {
  public constructor() {
    super('Interview experience document does not exist.');
    this.name = 'ExperienceDocumentNotFoundError';
  }
}

export class ExperienceDocumentConflictError extends Error {
  public constructor(message = 'Interview experience document changed.') {
    super(message);
    this.name = 'ExperienceDocumentConflictError';
  }
}

export class ExperienceDocumentParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExperienceDocumentParseError';
  }
}

export interface ExperienceDeletionImpact {
  readonly impactHash: string;
  readonly snapshot: ExperienceDeletionSnapshot;
  readonly counts: {
    readonly experiences: number;
    readonly questions: number;
    readonly artifacts: number;
  };
}

function safeFileName(value: string): string {
  const fileName = value.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  if (!fileName || fileName.length > 255) throw new TypeError('Experience file name is invalid.');
  return fileName;
}

function detectTemplate(text: string): typeof personalExperienceTemplateVersion | null {
  return text.includes(`模板版本：${personalExperienceTemplateVersion}`)
    ? personalExperienceTemplateVersion
    : null;
}

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

function validateRange(
  text: string,
  range: { readonly start: number; readonly end: number } | null,
): void {
  if (!range) return;
  if (range.start < 0 || range.end <= range.start || range.end > text.length) {
    throw new TypeError('Experience evidence range is invalid.');
  }
}

function validateEvidence(text: string, drafts: readonly InterviewExperienceDraft[]): void {
  drafts.forEach((draft) => {
    draft.questions.forEach((question) => {
      validateRange(text, question.questionEvidence);
      validateRange(text, question.answerEvidence);
    });
  });
}

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

export class InterviewExperienceService {
  readonly #repository: InterviewExperienceRepository;
  readonly #artifacts: ArtifactStore;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #maximumFileBytes: number;

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

  public list(): readonly ExperienceDocumentSummary[] {
    return this.#repository.list();
  }

  public get(idValue: string): ExperienceDocumentDetail {
    const detail = this.#repository.get(parseId(idValue, 'ExperienceDocument'));
    if (!detail) throw new ExperienceDocumentNotFoundError();
    return detail;
  }

  public async importFile(input: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly sourceMode?: 'upload' | 'online';
    readonly signal: AbortSignal;
  }): Promise<{ readonly detail: ExperienceDocumentDetail; readonly deduplicated: boolean }> {
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

  public previewDeletion(documentIdValue: string): ExperienceDeletionImpact {
    const snapshot = this.#repository.previewDeletion(
      parseId(documentIdValue, 'ExperienceDocument'),
    );
    if (!snapshot) throw new ExperienceDocumentNotFoundError();
    return deletionImpact(snapshot);
  }

  public async deleteConfirmed(input: {
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

export type SupportedExperienceMediaType = Exclude<ResumeMediaType, 'image/jpeg' | 'image/png'>;
