import { parseId, type Clock, type IdGenerator } from '@jobhunter/domain';
import {
  getResumeTemplate,
  profileToResumeContent,
  renderResumeHtml,
  resumeDocumentContentSchema,
  resumeTemplateKeySchema,
  resumeTemplates,
} from '@jobhunter/resume-template';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { CandidateProfileRepository } from '../ports/profiles.js';
import type {
  ResumeDraftRepository,
  ResumeExportFormat,
  ResumeExportRequestRecord,
  ResumeTemplateDraftRecord,
} from '../ports/resume-drafts.js';
import type { TaskService } from '../tasks/task-service.js';

const exportLifetimeMs = 24 * 60 * 60 * 1000;
const maximumAvatarBytes = 5 * 1024 * 1024;

/** 在线简历草稿、模板或导出请求不存在时抛出的应用错误。 */
export class ResumeTemplateNotFoundError extends Error {}
/** 在线简历草稿版本发生并发变化时抛出的乐观并发错误。 */
export class ResumeDraftConflictError extends Error {
  public readonly currentRevision: number | null;
  public constructor(currentRevision: number | null) {
    super('简历草稿已在其他页面更新，请重新载入后继续。');
    this.currentRevision = currentRevision;
  }
}

/** 将候选人姓名和模板名限制为安全的导出文件名片段。 */
function safeName(value: string): string {
  return (
    value
      .replaceAll(/[\\/:*?"<>|]/gu, '-')
      .replaceAll(/\s+/gu, ' ')
      .trim() || '我的简历'
  );
}

/** 校验头像内容签名与声明媒体类型一致。 */
function avatarMedia(bytes: Uint8Array, declared: string): 'image/jpeg' | 'image/png' {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumAvatarBytes) {
    throw new TypeError('头像必须非空且不超过 5 MiB。');
  }
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  if (jpeg && declared === 'image/jpeg') return 'image/jpeg';
  if (png && declared === 'image/png') return 'image/png';
  throw new TypeError('头像文件内容必须是 JPEG 或 PNG，并与声明类型一致。');
}

/** 应用层数据结构或端口契约。 */
export interface ResumeDraftDetail {
  readonly draft: ResumeTemplateDraftRecord;
  readonly template: (typeof resumeTemplates)[number];
  readonly currentProfileVersionId: string;
  readonly stale: boolean;
  readonly avatarDataUrl: string | null;
}

/** 管理在线简历草稿、模板渲染、头像和短期导出文件。 */
export class ResumeTemplateService {
  readonly #drafts: ResumeDraftRepository;
  readonly #profiles: CandidateProfileRepository;
  readonly #artifacts: ArtifactStore;
  readonly #tasks: TaskService;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  /** 执行应用组件对外暴露的操作。 */
  public constructor(input: {
    readonly drafts: ResumeDraftRepository;
    readonly profiles: CandidateProfileRepository;
    readonly artifacts: ArtifactStore;
    readonly tasks: TaskService;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#drafts = input.drafts;
    this.#profiles = input.profiles;
    this.#artifacts = input.artifacts;
    this.#tasks = input.tasks;
    this.#clock = input.clock;
    this.#ids = input.ids;
  }

  /** 返回当前可用的内置简历模板目录。 */
  public listTemplates(): typeof resumeTemplates {
    return resumeTemplates;
  }

  public async createOrResume(profileId: string, templateKey: string): Promise<ResumeDraftDetail> {
    // 1、校验画像和模板；同一画像、模板版本只保留一个可继续编辑的草稿。
    const key = resumeTemplateKeySchema.parse(templateKey);
    const template = getResumeTemplate(key);
    const profile = this.#profiles.getProfile(parseId(profileId, 'CandidateProfile'));
    const current = this.#profiles.getCurrentVersion(parseId(profileId, 'CandidateProfile'));
    if (!profile || !current) throw new ResumeTemplateNotFoundError('个人资料不存在或尚未生成。');
    const existing = this.#drafts.find(profileId, key, template.version);
    if (existing) return this.detail(existing.id);
    const now = this.#clock.now();
    let created: ResumeTemplateDraftRecord;
    try {
      created = this.#drafts.create({
        id: this.#ids.generate(),
        profileId,
        templateKey: key,
        templateVersion: template.version,
        sourceProfileVersionId: current.id,
        content: profileToResumeContent(current.effective),
        avatarFileId: null,
        avatarFileVersion: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      const raced = this.#drafts.find(profileId, key, template.version);
      if (!raced) throw error;
      created = raced;
    }
    // 2、返回包含最新画像版本状态的草稿详情。
    return this.detail(created.id);
  }

  /** 查询草稿并标记其来源画像是否已经过期。 */
  public async detail(id: string): Promise<ResumeDraftDetail> {
    const draft = this.#drafts.get(id);
    if (!draft) throw new ResumeTemplateNotFoundError('简历草稿不存在。');
    const current = this.#profiles.getCurrentVersion(parseId(draft.profileId, 'CandidateProfile'));
    if (!current) throw new ResumeTemplateNotFoundError('草稿所属个人资料不存在。');
    return {
      draft,
      template: getResumeTemplate(draft.templateKey, draft.templateVersion),
      currentProfileVersionId: current.id,
      stale: current.id !== draft.sourceProfileVersionId,
      avatarDataUrl: await this.#avatar(draft),
    };
  }

  /** 按乐观并发版本保存用户编辑后的在线简历内容。 */
  public async save(
    id: string,
    expectedRevision: number,
    content: unknown,
  ): Promise<ResumeDraftDetail> {
    const parsed = resumeDocumentContentSchema.parse(content);
    const updated = this.#drafts.update({
      id,
      expectedRevision,
      content: parsed,
      now: this.#clock.now(),
    });
    if (!updated) throw new ResumeDraftConflictError(this.#drafts.get(id)?.revision ?? null);
    return this.detail(updated.id);
  }

  /** 用最新画像刷新草稿，同时保留用户已有的排版设置。 */
  public async refresh(id: string, expectedRevision: number): Promise<ResumeDraftDetail> {
    const currentDraft = this.#drafts.get(id);
    if (!currentDraft) throw new ResumeTemplateNotFoundError('简历草稿不存在。');
    const current = this.#profiles.getCurrentVersion(
      parseId(currentDraft.profileId, 'CandidateProfile'),
    );
    if (!current) throw new ResumeTemplateNotFoundError('草稿所属个人资料不存在。');
    const updated = this.#drafts.update({
      id,
      expectedRevision,
      content: {
        ...profileToResumeContent(current.effective),
        ...(currentDraft.content.formatting ? { formatting: currentDraft.content.formatting } : {}),
      },
      sourceProfileVersionId: current.id,
      now: this.#clock.now(),
    });
    if (!updated) throw new ResumeDraftConflictError(this.#drafts.get(id)?.revision ?? null);
    return this.detail(id);
  }

  /** 保存并替换草稿头像；并发失败时清理刚写入的孤立文件。 */
  public async setAvatar(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly bytes: Uint8Array;
    readonly mediaType: string;
  }): Promise<ResumeDraftDetail> {
    const current = this.#drafts.get(input.id);
    if (!current) throw new ResumeTemplateNotFoundError('简历草稿不存在。');
    if (current.revision !== input.expectedRevision)
      throw new ResumeDraftConflictError(current.revision);
    const mediaType = avatarMedia(input.bytes, input.mediaType);
    const stored = await this.#artifacts.put({
      id: this.#ids.generate(),
      kind: 'resume_avatar',
      name: `resume-avatar-${current.id}`,
      mediaType,
      content: input.bytes,
      createdAt: this.#clock.now(),
      logicalFile: 'new',
    });
    const updated = this.#drafts.setAvatar({
      id: input.id,
      expectedRevision: input.expectedRevision,
      fileId: stored.id,
      fileVersion: stored.versionNo,
      now: this.#clock.now(),
    });
    if (!updated) {
      await this.#artifacts.remove({ id: stored.id, kind: 'resume_avatar' });
      throw new ResumeDraftConflictError(this.#drafts.get(input.id)?.revision ?? null);
    }
    if (current.avatarFileId)
      await this.#artifacts.remove({ id: current.avatarFileId, kind: 'resume_avatar' });
    return this.detail(input.id);
  }

  /** 执行应用组件对外暴露的操作。 */
  public async export(input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly format: ResumeExportFormat;
    readonly idempotencyToken: string;
  }): Promise<ResumeExportRequestRecord> {
    // 1、校验草稿版本并生成不可变 HTML 快照，短期文件不参与画像数据所有权。
    const token = input.idempotencyToken.trim();
    if (input.format === 'pdf' && !token) throw new TypeError('导出幂等标识不能为空。');
    const detail = await this.detail(input.id);
    if (detail.draft.revision !== input.expectedRevision)
      throw new ResumeDraftConflictError(detail.draft.revision);
    const now = this.#clock.now();
    const html = renderResumeHtml({
      templateKey: detail.draft.templateKey,
      templateVersion: detail.draft.templateVersion,
      content: detail.draft.content,
      avatarDataUrl: detail.avatarDataUrl,
      editable: input.format === 'html',
    });
    const requestId = this.#ids.generate();
    const snapshot = await this.#artifacts.put({
      id: this.#ids.generate(),
      kind: 'export',
      name: `resume-export-input-${requestId}.html`,
      mediaType: 'text/html; charset=utf-8',
      content: new TextEncoder().encode(html),
      createdAt: now,
      logicalFile: 'new',
    });
    const template = getResumeTemplate(detail.draft.templateKey, detail.draft.templateVersion);
    const extension = input.format === 'pdf' ? 'pdf' : 'html';
    const date = new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
    const request = this.#drafts.createExport({
      id: requestId,
      draftId: detail.draft.id,
      format: input.format,
      draftRevision: detail.draft.revision,
      inputFileId: snapshot.id,
      inputFileVersion: snapshot.versionNo,
      outputFileId: input.format === 'html' ? snapshot.id : null,
      outputFileVersion: input.format === 'html' ? snapshot.versionNo : null,
      taskId: null,
      status: input.format === 'html' ? 'succeeded' : 'pending',
      fileName: `${safeName(detail.draft.content.basicInfo.name ?? '我的简历')}-${safeName(template.name)}-${date}.${extension}`,
      errorSummary: null,
      expiresAt: (Number(now) + exportLifetimeMs) as ResumeExportRequestRecord['expiresAt'],
      createdAt: now,
      updatedAt: now,
    });
    // 2、HTML 可立即交付；PDF 只创建任务，交给 Worker 的浏览器渲染器执行。
    if (input.format === 'pdf') {
      const queued = this.#tasks.enqueue({
        taskType: 'resume.export.pdf@v1',
        payload: { requestId },
        idempotencyKey: `resume.export.pdf:${requestId}:${token}`,
        concurrencyKey: `resume.export.pdf:${requestId}`,
      });
      this.#drafts.attachTask(requestId, queued.task.id, now);
      return this.#drafts.getExport(requestId) ?? request;
    }
    return request;
  }

  /** 查询导出请求，并将关联任务失败映射为可展示状态。 */
  public getExport(draftId: string, requestId: string): ResumeExportRequestRecord {
    const request = this.#drafts.getExport(requestId);
    if (request?.draftId !== draftId) throw new ResumeTemplateNotFoundError('导出请求不存在。');
    if (request.status === 'pending' && request.taskId) {
      const task = this.#tasks.get(parseId(request.taskId, 'Task'));
      if (task?.status === 'failed' || task?.status === 'cancelled') {
        return {
          ...request,
          status: 'failed',
          errorSummary:
            task.errorSummary ??
            (task.status === 'cancelled' ? 'PDF 生成已取消。' : 'PDF 生成失败。'),
        };
      }
    }
    return request;
  }

  /** 读取已完成的导出文件并在交付后删除短期快照。 */
  public async deliver(
    draftId: string,
    requestId: string,
  ): Promise<{
    readonly bytes: Uint8Array;
    readonly mediaType: string;
    readonly fileName: string;
  }> {
    const request = this.getExport(draftId, requestId);
    if (request.status !== 'succeeded' || !request.outputFileId || !request.outputFileVersion)
      throw new TypeError('导出文件尚未生成。');
    const stored = await this.#artifacts.read({
      id: request.outputFileId,
      versionNo: request.outputFileVersion,
      kind: 'export',
      maximumBytes: 25 * 1024 * 1024,
    });
    await this.#removeExport(request);
    return { bytes: stored.content, mediaType: stored.mediaType, fileName: request.fileName };
  }

  /** 清理已过期的 HTML/PDF 导出快照。 */
  public async cleanupExpiredExports(): Promise<number> {
    const expired = this.#drafts.listExpired(this.#clock.now());
    for (const request of expired) await this.#removeExport(request);
    return expired.length;
  }

  /** 删除导出记录及其去重后的输入/输出文件实体。 */
  async #removeExport(request: ResumeExportRequestRecord): Promise<void> {
    this.#drafts.deleteExport(request.id);
    const fileIds = new Set(
      [request.inputFileId, request.outputFileId].filter((id): id is string => Boolean(id)),
    );
    for (const id of fileIds) await this.#artifacts.remove({ id, kind: 'export' });
  }

  /** 读取头像并转换为仅供 HTML 渲染使用的数据 URL。 */
  async #avatar(draft: ResumeTemplateDraftRecord): Promise<string | null> {
    if (!draft.avatarFileId || !draft.avatarFileVersion) return null;
    const stored = await this.#artifacts.read({
      id: draft.avatarFileId,
      versionNo: draft.avatarFileVersion,
      kind: 'resume_avatar',
      maximumBytes: maximumAvatarBytes,
    });
    const base64 = Buffer.from(stored.content).toString('base64');
    return `data:${stored.mediaType};base64,${base64}`;
  }
}
