import type { ResumeDocumentContent, ResumeTemplateKey } from '@jobhunter/resume-template';
import type { UtcInstant } from '@jobhunter/domain';

export interface ResumeTemplateDraftRecord {
  readonly id: string;
  readonly profileId: string;
  readonly templateKey: ResumeTemplateKey;
  readonly templateVersion: number;
  readonly sourceProfileVersionId: string;
  readonly content: ResumeDocumentContent;
  readonly avatarFileId: string | null;
  readonly avatarFileVersion: number | null;
  readonly revision: number;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

export type ResumeExportFormat = 'pdf' | 'html';
export type ResumeExportStatus = 'pending' | 'succeeded' | 'failed' | 'delivered';

export interface ResumeExportRequestRecord {
  readonly id: string;
  readonly draftId: string;
  readonly format: ResumeExportFormat;
  readonly draftRevision: number;
  readonly inputFileId: string;
  readonly inputFileVersion: number;
  readonly outputFileId: string | null;
  readonly outputFileVersion: number | null;
  readonly taskId: string | null;
  readonly status: ResumeExportStatus;
  readonly fileName: string;
  readonly errorSummary: string | null;
  readonly expiresAt: UtcInstant;
  readonly createdAt: UtcInstant;
  readonly updatedAt: UtcInstant;
}

export interface ResumeDraftRepository {
  find(
    profileId: string,
    templateKey: ResumeTemplateKey,
    templateVersion: number,
  ): ResumeTemplateDraftRecord | null;
  get(id: string): ResumeTemplateDraftRecord | null;
  create(record: ResumeTemplateDraftRecord): ResumeTemplateDraftRecord;
  update(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly content: ResumeDocumentContent;
    readonly sourceProfileVersionId?: string;
    readonly now: UtcInstant;
  }): ResumeTemplateDraftRecord | null;
  setAvatar(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly fileId: string;
    readonly fileVersion: number;
    readonly now: UtcInstant;
  }): ResumeTemplateDraftRecord | null;
  createExport(record: ResumeExportRequestRecord): ResumeExportRequestRecord;
  getExport(id: string): ResumeExportRequestRecord | null;
  attachTask(id: string, taskId: string, now: UtcInstant): void;
  completeExport(input: {
    readonly id: string;
    readonly outputFileId: string;
    readonly outputFileVersion: number;
    readonly now: UtcInstant;
  }): void;
  failExport(id: string, message: string, now: UtcInstant): void;
  markDelivered(id: string, now: UtcInstant): void;
  listExpired(now: UtcInstant): readonly ResumeExportRequestRecord[];
  deleteExport(id: string): void;
}
