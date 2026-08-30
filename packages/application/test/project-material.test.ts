import {
  contentHash,
  parseContentHash,
  parseId,
  utcInstant,
  type IdGenerator,
} from '@jobhunter/domain';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactStore, InterviewProjectRepository } from '../src/index.js';
import {
  parseProjectMaterial,
  ProjectMaterialError,
  ProjectMaterialService,
} from '../src/interview/index.js';

class SequentialIds implements IdGenerator {
  #next = 1;

  public generate(): string {
    const suffix = String(this.#next++).padStart(12, '0');
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

describe('project material parsing', () => {
  it('normalizes Markdown and preserves exact bounded evidence ranges', () => {
    const parsed = parseProjectMaterial(
      new TextEncoder().encode(
        '# 架构\r\n\r\n服务通过事件驱动协作。  \r\n\r\n## 取舍\r\n\r\n为了可恢复性，写入路径保留了幂等键。\r\n',
      ),
      new SequentialIds(),
    );

    expect(parsed.normalizedText).not.toContain('\r');
    expect(parsed.normalizedText).not.toContain('  \n');
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.chunks.map((chunk) => chunk.heading)).toEqual(['架构', '架构 › 取舍']);
    for (const chunk of parsed.chunks) {
      const excerpt = parsed.normalizedText.slice(chunk.start, chunk.end);
      expect(excerpt).not.toBe('');
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(3_000);
      expect(chunk.contentHash).toBe(contentHash(excerpt));
    }
  });

  it('splits long sections without losing or fabricating evidence', () => {
    const paragraph = `${'架构细节'.repeat(150)}\n\n`;
    const parsed = parseProjectMaterial(
      new TextEncoder().encode(`# 实现\n\n${paragraph.repeat(6)}`),
      new SequentialIds(),
    );

    expect(parsed.chunks.length).toBeGreaterThan(1);
    expect(parsed.chunks.every((chunk) => chunk.end - chunk.start <= 3_000)).toBe(true);
    expect(parsed.chunks.every((chunk) => chunk.heading === '实现')).toBe(true);
  });

  it('rejects empty, invalid UTF-8, NUL and oversized documents', () => {
    const ids = new SequentialIds();

    expect(() => parseProjectMaterial(new Uint8Array(), ids)).toThrow(ProjectMaterialError);
    expect(() => parseProjectMaterial(Uint8Array.from([0xc3, 0x28]), ids)).toThrow(/UTF-8/u);
    expect(() => parseProjectMaterial(new TextEncoder().encode('ok\u0000bad'), ids)).toThrow(
      /NUL/u,
    );
    expect(() => parseProjectMaterial(new Uint8Array(512 * 1024 + 1), ids)).toThrow(/512 KiB/u);
  });

  it('rejects Markdown headings longer than 500 characters before allocating chunks', () => {
    const generate = vi.fn(() => '018f0000-0000-7000-8000-000000000001');

    expect(() =>
      parseProjectMaterial(new TextEncoder().encode(`# ${'标'.repeat(501)}\n\n正文`), { generate }),
    ).toThrow(ProjectMaterialError);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('project material import', () => {
  it('claims the logical identity before writing and uses the canonical file id', async () => {
    const dossierId = parseId('018f0000-0000-7000-8000-000000000101', 'ProjectDossier');
    const canonicalFileId = '018f0000-0000-7000-8000-000000000102';
    const entityId = '018f0000-0000-7000-8000-000000000103';
    const now = utcInstant(1_800_000_000_000);
    const bytes = new TextEncoder().encode('# 架构\n\n模块化单体。');
    const order: string[] = [];
    const claimMaterialFile = vi.fn(() => {
      order.push('claim');
      return canonicalFileId;
    });
    const registerMaterial = vi.fn(
      (input: Parameters<InterviewProjectRepository['registerMaterial']>[0]) => {
        order.push('register');
        return {
          deduplicated: false,
          material: {
            fileId: input.fileId,
            entityId: input.entityId,
            versionNo: 1,
            fileName: input.fileName,
            contentHash: parseContentHash('a'.repeat(64)),
            dossierId: input.dossierId,
            mediaType: 'text/markdown; charset=utf-8' as const,
            byteSize: bytes.byteLength,
            chunks: input.chunks,
            createdAt: input.now,
            updatedAt: input.now,
          },
        };
      },
    );
    const repository = {
      getDossier: () => ({ dossier: { id: dossierId } }),
      findMaterialByName: () => null,
      claimMaterialFile,
      registerMaterial,
    } as unknown as InterviewProjectRepository;
    const put = vi.fn((input: Parameters<ArtifactStore['put']>[0]) => {
      order.push('put');
      return Promise.resolve({
        id: input.id,
        entityId,
        versionNo: 1,
        kind: input.kind,
        relativePath: 'artifacts/aa/material',
        mediaType: input.mediaType,
        sha256: parseContentHash('a'.repeat(64)),
        byteSize: input.content.byteLength,
        createdAt: input.createdAt,
      });
    });
    const artifacts = { put } as unknown as ArtifactStore;
    const service = new ProjectMaterialService({
      repository,
      artifacts,
      ids: new SequentialIds(),
    });

    const result = await service.import({
      dossierId,
      fileName: 'architecture.md',
      bytes,
      createdAt: now,
      signal: new AbortController().signal,
    });

    expect(order).toEqual(['claim', 'put', 'register']);
    expect(claimMaterialFile).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId, fileName: 'architecture.md', now }),
    );
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ id: canonicalFileId, logicalFile: 'reuse' }),
    );
    expect(registerMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: canonicalFileId, entityId }),
    );
    expect(result.material.fileId).toBe(canonicalFileId);
  });

  it('rejects an overlong nested heading path before any persistent write', async () => {
    const dossierId = parseId('018f0000-0000-7000-8000-000000000111', 'ProjectDossier');
    const claimMaterialFile = vi.fn();
    const registerMaterial = vi.fn();
    const repository = {
      getDossier: () => ({ dossier: { id: dossierId } }),
      findMaterialByName: vi.fn(),
      claimMaterialFile,
      registerMaterial,
    } as unknown as InterviewProjectRepository;
    const put = vi.fn();
    const service = new ProjectMaterialService({
      repository,
      artifacts: { put } as unknown as ArtifactStore,
      ids: new SequentialIds(),
    });

    await expect(
      service.import({
        dossierId,
        fileName: 'architecture.md',
        bytes: new TextEncoder().encode(
          `# ${'父'.repeat(300)}\n\n正文\n\n## ${'子'.repeat(300)}\n\n更多正文`,
        ),
        createdAt: utcInstant(1_800_000_000_000),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Markdown 标题路径.*500/u);
    expect(claimMaterialFile).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(registerMaterial).not.toHaveBeenCalled();
  });
});
