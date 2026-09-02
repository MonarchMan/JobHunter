import { z } from 'zod';
import type { IdGenerator } from '@jobhunter/domain';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { ResumeDraftRepository } from '../ports/resume-drafts.js';
import type { TaskHandler } from '../tasks/model.js';

export interface ResumePdfRenderer {
  render(html: string, signal: AbortSignal): Promise<Uint8Array>;
}

const payloadSchema = z.object({ requestId: z.string().min(1) });
const outputSchema = z.object({ requestId: z.string().min(1), fileId: z.string().min(1) });

export function createResumePdfExportTaskHandler(
  input: {
    readonly repository?: ResumeDraftRepository;
    readonly artifacts?: ArtifactStore;
    readonly renderer?: ResumePdfRenderer;
    readonly ids?: IdGenerator;
  } = {},
): TaskHandler<z.infer<typeof payloadSchema>, z.infer<typeof outputSchema>> {
  return {
    taskType: 'resume.export.pdf@v1',
    payloadSchema,
    outputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `resume.export.pdf:${payload.requestId}`,
    async execute(context, payload) {
      const { repository, artifacts, renderer, ids } = input;
      if (!repository || !artifacts || !renderer || !ids)
        throw new TypeError('PDF 导出执行器在当前进程不可用。');
      const request = repository.getExport(payload.requestId);
      if (!request) throw new TypeError('PDF 导出请求不存在。');
      if (request.status === 'succeeded' && request.outputFileId)
        return { requestId: request.id, fileId: request.outputFileId };
      const source = await artifacts.read({
        id: request.inputFileId,
        versionNo: request.inputFileVersion,
        kind: 'export',
        maximumBytes: 10 * 1024 * 1024,
        signal: context.signal,
      });
      const html = new TextDecoder('utf-8', { fatal: true }).decode(source.content);
      const pdf = await renderer.render(html, context.signal);
      const stored = await artifacts.put({
        id: ids.generate(),
        kind: 'export',
        name: request.fileName,
        mediaType: 'application/pdf',
        content: pdf,
        createdAt: context.clock.now(),
        logicalFile: 'new',
      });
      repository.completeExport({
        id: request.id,
        outputFileId: stored.id,
        outputFileVersion: stored.versionNo,
        now: context.clock.now(),
      });
      return { requestId: request.id, fileId: stored.id };
    },
  };
}

const cleanupOutputSchema = z.object({ deleted: z.number().int().nonnegative() });

export function createResumeExportCleanupTaskHandler(
  input: {
    readonly repository?: ResumeDraftRepository;
    readonly artifacts?: ArtifactStore;
  } = {},
): TaskHandler<Record<string, never>, z.infer<typeof cleanupOutputSchema>> {
  return {
    taskType: 'resume.export.cleanup@v1',
    payloadSchema: z.object({}).strict(),
    outputSchema: cleanupOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: () => 'resume.export.cleanup',
    async execute(context) {
      const { repository, artifacts } = input;
      if (!repository || !artifacts) throw new TypeError('简历导出清理器在当前进程不可用。');
      const expired = repository.listExpired(context.clock.now());
      for (const request of expired) {
        repository.deleteExport(request.id);
        const fileIds = new Set(
          [request.inputFileId, request.outputFileId].filter((id): id is string => Boolean(id)),
        );
        for (const id of fileIds) await artifacts.remove({ id, kind: 'export' });
      }
      return { deleted: expired.length };
    },
  };
}
