import { readFile } from 'node:fs/promises';
import {
  ExperienceDocumentConflictError,
  InterviewExperienceService,
} from '@jobhunter/application';
import {
  utcInstant,
  type Clock,
  type InterviewExperienceDraft,
  type UtcInstant,
} from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteArtifactStore,
  SqliteInterviewExperienceRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class FixedClock implements Clock {
  public now(): UtcInstant {
    return utcInstant(1_800_000_000_000);
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter = 0x9000;

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

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly service: InterviewExperienceService;
}> {
  const root = await createTemporaryDataRoot('jobhunter-interview-experience-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  return {
    handle,
    service: new InterviewExperienceService({
      repository: new SqliteInterviewExperienceRepository(handle.client),
      artifacts: new SqliteArtifactStore(handle.client, root.path),
      clock: new FixedClock(),
      ids: new SequentialIds(),
    }),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function draftsFrom(
  detail: ReturnType<InterviewExperienceService['get']>,
): readonly InterviewExperienceDraft[] {
  return detail.experiences.map((experience) => ({
    sequenceNo: experience.sequenceNo,
    company: experience.company,
    role: experience.role,
    stage: experience.stage,
    occurredOn: experience.occurredOn,
    outcome: experience.outcome,
    difficulty: experience.difficulty,
    tags: experience.tags,
    notes: experience.notes,
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

describe('personal interview experience persistence', () => {
  it('imports, deduplicates, CAS-edits and accepts a document', async () => {
    const { handle, service } = await setup();
    const bytes = await readFile(
      new URL('../../../docs/templates/personal-interview-experience-v1.md', import.meta.url),
    );
    const first = await service.importFile({
      bytes,
      fileName: 'my-experience.md',
      signal: new AbortController().signal,
    });
    const replay = await service.importFile({
      bytes,
      fileName: 'renamed.md',
      signal: new AbortController().signal,
    });

    expect(first.deduplicated).toBe(false);
    expect(first.detail.document).toMatchObject({
      fileName: 'my-experience.md',
      templateVersion: 'personal-experience@v1',
      status: 'draft',
      revision: 0,
    });
    expect(first.detail.questions).toHaveLength(2);
    expect(replay).toMatchObject({
      deduplicated: true,
      detail: { document: { id: first.detail.document.id, fileName: 'my-experience.md' } },
    });
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(1);
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_experience'")
        .pluck()
        .get(),
    ).toBe(1);

    const drafts = draftsFrom(first.detail);
    const current = drafts[0];
    if (!current) throw new Error('Expected one parsed experience.');
    const changed = service.replaceDraft({
      documentId: first.detail.document.id,
      expectedRevision: 0,
      experiences: [
        {
          ...current,
          company: '校对后的公司',
          questions: current.questions.map((question, index) =>
            index === 0
              ? { ...question, answer: '查看执行计划并对比扫描行数。', answerEvidence: null }
              : question,
          ),
        },
      ],
    });
    expect(changed.document).toMatchObject({ revision: 1 });
    expect(changed.experiences[0]?.company).toBe('校对后的公司');
    expect(() =>
      service.replaceDraft({
        documentId: first.detail.document.id,
        expectedRevision: 0,
        experiences: drafts,
      }),
    ).toThrow(ExperienceDocumentConflictError);

    const accepted = service.accept({
      documentId: changed.document.id,
      expectedRevision: changed.document.revision,
    });
    expect(accepted.document).toMatchObject({ status: 'accepted', revision: 2 });
    expect(() =>
      service.replaceDraft({
        documentId: accepted.document.id,
        expectedRevision: accepted.document.revision,
        experiences: draftsFrom(accepted),
      }),
    ).toThrow(ExperienceDocumentConflictError);
  });

  it('previews deletion and preserves an artifact shared with another source', async () => {
    const { handle, service } = await setup();
    const created = await service.createOnline(
      {
        sequenceNo: 1,
        company: '云杉网络',
        role: '平台工程师',
        stage: '一面',
        occurredOn: null,
        outcome: null,
        difficulty: null,
        tags: [],
        notes: null,
        questions: [
          {
            sequenceNo: 1,
            question: '如何设计灰度发布？',
            answer: null,
            reflection: null,
            questionEvidence: null,
            answerEvidence: null,
          },
        ],
      },
      new AbortController().signal,
    );
    const document = created.detail.document;
    handle.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'resume', 'shared-resume.md', 'parsed', 0, '{}', ?, ?)`,
      )
      .run('018f0000-0000-7000-8000-000000009999', document.createdAt, document.createdAt);
    handle.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, parser_version, parse_status, extracted_text,
          metadata_json, created_at)
         VALUES (?, ?, 1, 'fixture', 'parsed', ?, '{}', ?)`,
      )
      .run(
        '018f0000-0000-7000-8000-000000009999',
        document.artifactId,
        document.extractedText,
        document.createdAt,
      );

    const impact = service.previewDeletion(document.id);
    expect(impact.counts).toEqual({ experiences: 1, questions: 1, artifacts: 0 });
    await expect(
      service.deleteConfirmed({ documentId: document.id, expectedImpactHash: '0'.repeat(64) }),
    ).rejects.toThrow(ExperienceDocumentConflictError);
    await service.deleteConfirmed({
      documentId: document.id,
      expectedImpactHash: impact.impactHash,
    });

    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_experience'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(handle.client.prepare('SELECT count(*) FROM interview_experiences').pluck().get()).toBe(
      0,
    );
    expect(
      handle.client.prepare('SELECT count(*) FROM interview_question_entries').pluck().get(),
    ).toBe(0);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(1);
    expect(
      handle.client.prepare("SELECT count(*) FROM files WHERE kind = 'resume'").pluck().get(),
    ).toBe(1);
  });
});
