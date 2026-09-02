import {
  ResumeDraftConflictError,
  ResumeTemplateNotFoundError,
  resolveAppConfig,
  resolveBootstrapConfig,
} from '@jobhunter/application';
import { openSqliteDatabase } from '@jobhunter/db';
import { createTemporaryDataRoot, makeCandidateProfile } from '@jobhunter/testkit';
import { describe, expect, it } from 'vitest';
import { createLocalWebContainer } from '../src/server/container.js';

const profileId = '018f0000-0000-7000-8000-000000000901';
const versionId = '018f0000-0000-7000-8000-000000000902';

function seedProfile(dataRoot: string): void {
  const database = openSqliteDatabase({ dataRoot });
  const profile = makeCandidateProfile({
    basicInfo: {
      name: '模板候选人',
      phone: '13800000000',
      email: 'candidate@example.com',
      location: '上海',
      website: null,
    },
    targetRoles: ['Agent 工程师'],
  });
  try {
    database.client
      .prepare(
        `INSERT INTO candidate_profiles (id, name, created_at, updated_at)
       VALUES (?, '模板候选人', 1, 1)`,
      )
      .run(profileId);
    database.client
      .prepare(
        `INSERT INTO profile_versions
       (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
        content_hash, is_current, created_at)
       VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
      )
      .run(versionId, profileId, JSON.stringify(profile), JSON.stringify(profile), 'd'.repeat(64));
  } finally {
    database.close();
  }
}

describe('Web resume template composition', () => {
  it('restores per-template drafts, enforces revisions, refreshes safely and cleans delivered files', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-resume-template-');
    try {
      seedProfile(root.path);
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(
        resolveAppConfig({ bootstrap, environment: {}, file: {} }),
      );
      try {
        const service = container.services.resumeTemplates;
        const technical = await service.createOrResume(profileId, 'technical-blueprint');
        const restored = await service.createOrResume(profileId, 'technical-blueprint');
        const clean = await service.createOrResume(profileId, 'clean-single-column');
        expect(restored.draft.id).toBe(technical.draft.id);
        expect(clean.draft.id).not.toBe(technical.draft.id);

        const editedContent = {
          ...technical.draft.content,
          selfEvaluation: '模板草稿中的独立修改',
        };
        const edited = await service.save(technical.draft.id, 0, editedContent);
        await expect(service.save(technical.draft.id, 0, editedContent)).rejects.toBeInstanceOf(
          ResumeDraftConflictError,
        );

        const withAvatar = await service.setAvatar({
          id: technical.draft.id,
          expectedRevision: edited.draft.revision,
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
          mediaType: 'image/png',
        });
        expect(withAvatar.avatarDataUrl).toMatch(/^data:image\/png;base64,/u);
        await expect(
          service.setAvatar({
            id: technical.draft.id,
            expectedRevision: withAvatar.draft.revision,
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]),
            mediaType: 'image/png',
          }),
        ).rejects.toThrow(/声明类型一致/u);

        const current = container.services.webProfiles.get(profileId);
        container.services.webProfiles.mutate({
          kind: 'set',
          profileId,
          expectedVersionId: current.current.id,
          pointer: '/selfEvaluation',
          value: '在线简历的新内容',
        });
        expect((await service.detail(technical.draft.id)).stale).toBe(true);
        const refreshed = await service.refresh(technical.draft.id, withAvatar.draft.revision);
        expect(refreshed.draft.content.selfEvaluation).toBe('在线简历的新内容');
        expect(refreshed.avatarDataUrl).toBe(withAvatar.avatarDataUrl);

        const html = await service.export({
          id: technical.draft.id,
          expectedRevision: refreshed.draft.revision,
          format: 'html',
          idempotencyToken: '',
        });
        const delivered = await service.deliver(technical.draft.id, html.id);
        expect(new TextDecoder().decode(delivered.bytes)).toContain('在线简历的新内容');
        expect(delivered.fileName).toMatch(/模板候选人-技术蓝图-\d{8}\.html$/u);
        expect(() => service.getExport(technical.draft.id, html.id)).toThrow(
          ResumeTemplateNotFoundError,
        );

        const database = openSqliteDatabase({ dataRoot: root.path });
        try {
          expect(
            database.client
              .prepare("SELECT count(*) FROM files WHERE kind = 'export'")
              .pluck()
              .get(),
          ).toBe(0);
          expect(
            database.client.prepare('SELECT count(*) FROM resume_export_requests').pluck().get(),
          ).toBe(0);
        } finally {
          database.close();
        }

        const pdf = await service.export({
          id: technical.draft.id,
          expectedRevision: refreshed.draft.revision,
          format: 'pdf',
          idempotencyToken: 'pdf-export-test',
        });
        expect(pdf).toMatchObject({ format: 'pdf', status: 'pending' });
        expect(pdf.taskId).not.toBeNull();
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
