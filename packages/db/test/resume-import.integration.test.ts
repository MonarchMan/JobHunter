import { readFile } from 'node:fs/promises';
import { ResumeImportService } from '@jobhunter/application';
import { utcInstant, type Clock, type UtcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteArtifactStore,
  SqliteResumeDocumentRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

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

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

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
  it('imports the redacted Agent DOCX and deduplicates both artifact and document', async () => {
    const { handle, service } = await setup();
    const bytes = await readFile(
      new URL('../../../docs/resumes/agent简历 - 新.docx', import.meta.url),
    );
    const first = await service.import(bytes, new AbortController().signal);
    const replay = await service.import(bytes, new AbortController().signal);

    expect(first.deduplicated).toBe(false);
    expect(first.document.parseStatus).toBe('parsed');
    expect(first.document.mediaType).toContain('wordprocessingml');
    expect(first.document.extractedText).toContain('Coding Agent');
    expect(replay).toMatchObject({ deduplicated: true, document: { id: first.document.id } });
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
    expect(handle.client.prepare('SELECT count(*) FROM resume_documents').pluck().get()).toBe(1);
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

  it('cancels before writing sensitive artifacts', async () => {
    const { handle, service } = await setup();
    const abort = new AbortController();
    abort.abort();
    await expect(
      service.import(new TextEncoder().encode('resume'.repeat(50)), abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(0);
  });
});
