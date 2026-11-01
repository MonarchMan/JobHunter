import { ResumeImportService } from '@jobhunter/user/profile';
import { utcInstant, type Clock, type UtcInstant } from '@jobhunter/common/domain';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { SqliteArtifactStore } from '@jobhunter/user/persistence/artifact-store';
import { SqliteResumeArtifactReader } from '@jobhunter/user/persistence/resume-artifact-reader';
import { SqliteResumeDocumentRepository } from '@jobhunter/user/persistence/resume-document-repository';

/** 构造测试输入或执行断言的辅助逻辑。 */
class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x7000;

  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

const resources: {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}[] = [];

// 测试只需要 JPEG 签名，不依赖用户本地的真实简历文件。
const referenceJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly service: ResumeImportService;
}> {
  const root = await createTemporaryDataRoot('jobhunter-resume-import-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  return {
    handle,
    service: new ResumeImportService({
      artifacts: new SqliteArtifactStore(handle.client, root.path),
      documents: new SqliteResumeDocumentRepository(handle.client),
      clock: new FixedClock(),
      ids: new SequentialIds(),
    }),
  };
}

describe('resume import persistence', () => {
  it('imports a synthetic JPEG and deduplicates both artifact and document', async () => {
    const { handle, service } = await setup();
    const bytes = referenceJpeg;
    const first = await service.import(bytes, new AbortController().signal);
    const replay = await service.import(bytes, new AbortController().signal);

    expect(first.deduplicated).toBe(false);
    expect(first.document.parseStatus).toBe('needs_ocr');
    expect(first.document.mediaType).toBe('image/jpeg');
    expect(first.document.extractedText).toBeNull();
    expect(replay).toMatchObject({ deduplicated: true, document: { id: first.document.id } });
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(1);
    expect(
      handle.client.prepare("SELECT count(*) FROM files WHERE kind = 'resume'").pluck().get(),
    ).toBe(1);
  });

  it('records low-quality parsing without creating an active profile version', async () => {
    const { handle, service } = await setup();
    const result = await service.import(
      new TextEncoder().encode('太短'),
      new AbortController().signal,
    );
    expect(result.document).toMatchObject({
      parseStatus: 'failed',
      extractedText: null,
      errorSummary: 'Resume contains too little readable text.',
    });
    expect(handle.client.prepare('SELECT count(*) FROM profile_versions').pluck().get()).toBe(0);
  });

  it('keeps the stored synthetic JPEG artifact readable for the Worker', async () => {
    const { handle, service } = await setup();
    const bytes = referenceJpeg;
    const result = await service.import(bytes, new AbortController().signal);
    expect(result.document).toMatchObject({
      mediaType: 'image/jpeg',
      parseStatus: 'needs_ocr',
      extractedText: null,
    });
    const root = resources.at(-1)?.root.path;
    if (!root) throw new TypeError('Temporary data root is missing.');
    const stored = await new SqliteResumeArtifactReader(handle.client, root).read(
      result.document.artifactId,
      10 * 1024 * 1024,
      new AbortController().signal,
    );
    expect(stored).toEqual(new Uint8Array(bytes));
  });

  it('cancels before writing sensitive artifacts', async () => {
    const { handle, service } = await setup();
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.import(new TextEncoder().encode('resume'.repeat(50)), abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(0);
  });
});
