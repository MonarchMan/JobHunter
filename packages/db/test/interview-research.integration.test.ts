import {
  createExperienceResearchTaskHandler,
  ExperienceResearchBundleError,
  ExperienceResearchConflictError,
  ExperienceResearchService,
  HandlerRegistry,
  TaskService,
  type ArtifactStore,
  type ExternalResearchExecutor,
} from '@jobhunter/application';
import {
  communityQuestionFingerprint,
  communityResearchSchemaVersion,
  contentHash,
  researchRequestFingerprint,
  utcInstant,
  type Clock,
  type CommunityResearchBundle,
  type ExperienceResearchBrief,
  type TaskId,
  type UtcInstant,
} from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteArtifactStore,
  SqliteInterviewProjectRepository,
  SqliteInterviewResearchRepository,
  SqliteInterviewTaskPublisher,
  SqliteInterviewTaskRetryCoordinator,
  SqliteTaskRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class TestClock implements Clock {
  #value = 1_800_000_000_000;

  public now(): UtcInstant {
    return utcInstant(this.#value++);
  }

  /** 执行测试替身或时钟的操作。 */
  public advance(milliseconds: number): void {
    this.#value += milliseconds;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class SequentialIds {
  #counter: number;

  public constructor(start = 0xa000) {
    this.#counter = start;
  }

  /** 执行测试替身或时钟的操作。 */
  public generate(): string {
    const suffix = this.#counter.toString(16).padStart(12, '0');
    this.#counter += 1;
    return `018f0000-0000-7000-8000-${suffix}`;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class FailFinalizeOnceResearchRepository extends SqliteInterviewResearchRepository {
  #shouldFail = true;

  public override replaceCandidates(
    input: Parameters<SqliteInterviewResearchRepository['replaceCandidates']>[0],
  ): ReturnType<SqliteInterviewResearchRepository['replaceCandidates']> {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      return null;
    }
    return super.replaceCandidates(input);
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

const brief: ExperienceResearchBrief = {
  targetRoles: ['后端工程师'],
  companies: ['示例科技'],
  locations: ['上海'],
  levels: [],
  stages: [],
  dateFrom: null,
  dateTo: null,
  language: 'zh-CN',
  maxSources: 3,
  maxQuestionsPerSource: 3,
  allowedDomains: ['nowcoder.com'],
  blockedDomains: [],
};

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(options: { readonly failFinalizeOnce?: boolean } = {}): Promise<{
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
  readonly repository: SqliteInterviewResearchRepository;
  readonly artifacts: SqliteArtifactStore;
  readonly clock: TestClock;
  readonly queue: SqliteTaskRepository;
  readonly tasks: TaskService;
  readonly service: ExperienceResearchService;
}> {
  const root = await createTemporaryDataRoot('jobhunter-interview-research-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  const repository = options.failFinalizeOnce
    ? new FailFinalizeOnceResearchRepository(handle.client)
    : new SqliteInterviewResearchRepository(handle.client);
  const artifacts = new SqliteArtifactStore(handle.client, root.path);
  const clock = new TestClock();
  const ids = new SequentialIds();
  const registry = new HandlerRegistry();
  registry.register(createExperienceResearchTaskHandler({ unavailable: true }));
  const queue = new SqliteTaskRepository(handle.client);
  const tasks = new TaskService(
    { queue, clock, ids },
    registry,
    null,
    new SqliteInterviewTaskRetryCoordinator(handle.client, queue),
  );
  const taskPublisher = new SqliteInterviewTaskPublisher({
    client: handle.client,
    tasks,
    projects: new SqliteInterviewProjectRepository(handle.client),
    research: repository,
  });
  return {
    root,
    handle,
    repository,
    artifacts,
    clock,
    queue,
    tasks,
    service: new ExperienceResearchService({
      repository,
      artifacts,
      clock,
      ids,
      tasks,
      taskPublisher,
    }),
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function researchBundle(generatedAt = '2026-08-30T08:00:00.000Z'): CommunityResearchBundle {
  const question = '如何定位一次线上慢查询？';
  return {
    schemaVersion: communityResearchSchemaVersion,
    requestFingerprint: researchRequestFingerprint(brief),
    generatedAt,
    sources: [
      {
        url: 'https://nowcoder.com/interviews/one',
        title: '面试经历一',
        publishedAt: null,
        retrievedAt: '2026-08-30T07:00:00.000Z',
      },
      {
        url: 'https://nowcoder.com/interviews/two',
        title: '面试经历二',
        publishedAt: '2026-08-01T00:00:00.000Z',
        retrievedAt: '2026-08-30T07:10:00.000Z',
      },
    ],
    experiences: [
      {
        company: '示例科技',
        role: '后端工程师',
        stage: '一面',
        occurredAt: null,
        sourceUrl: 'https://nowcoder.com/interviews/one',
        questions: [
          {
            text: question,
            answerExcerpt: '原文提到先查执行计划。',
            topics: ['SQL'],
            evidenceExcerpt: '原文记录了慢查询排查题。',
          },
        ],
      },
      {
        company: '示例科技',
        role: '后端工程师',
        stage: '二面',
        occurredAt: '2026-08-01',
        sourceUrl: 'https://nowcoder.com/interviews/two',
        questions: [
          {
            text: question,
            answerExcerpt: null,
            topics: ['数据库'],
            evidenceExcerpt: '另一位面试者也记录了同一问题。',
          },
        ],
      },
    ],
    warnings: ['部分来源没有标注确切面试日期。'],
  };
}

describe('community interview research persistence', () => {
  it('deduplicates concurrent creation without leaving extra prompt or schema files', async () => {
    const { root, handle, service } = await setup();
    const secondHandle = openSqliteDatabase({ dataRoot: root.path });
    const secondService = new ExperienceResearchService({
      repository: new SqliteInterviewResearchRepository(secondHandle.client),
      artifacts: new SqliteArtifactStore(secondHandle.client, root.path),
      clock: new TestClock(),
      ids: new SequentialIds(0xb000),
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          (index % 2 === 0 ? service : secondService).create(brief),
        ),
      );

      expect(new Set(results.map((result) => result.detail.request.id))).toHaveLength(1);
      expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
      expect(
        handle.client.prepare('SELECT count(*) FROM experience_research_requests').pluck().get(),
      ).toBe(1);
      expect(
        handle.client
          .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
          .pluck()
          .get(),
      ).toBe(2);
      expect(
        handle.client
          .prepare(
            `SELECT count(*) FROM file_entity_mappings mapping
             JOIN files file ON file.id = mapping.file_id
             WHERE file.kind = 'interview_research'`,
          )
          .pluck()
          .get(),
      ).toBe(2);
    } finally {
      secondHandle.close();
    }
  });

  it('reads the prompt and schema versions frozen on the request', async () => {
    const { artifacts, clock, service } = await setup();
    const created = await service.create(brief);
    const frozenPrompt = await service.prompt(created.detail.request.id);
    const frozenSchema = await service.schema(created.detail.request.id);

    await artifacts.put({
      id: created.detail.request.promptFileId,
      kind: 'interview_research',
      mediaType: 'text/markdown; charset=utf-8',
      content: new TextEncoder().encode('future prompt renderer'),
      createdAt: clock.now(),
      logicalFile: 'new',
    });
    await artifacts.put({
      id: created.detail.request.schemaFileId,
      kind: 'interview_research',
      mediaType: 'application/schema+json',
      content: new TextEncoder().encode('{"type":"string"}'),
      createdAt: clock.now(),
      logicalFile: 'new',
    });

    expect(await service.prompt(created.detail.request.id)).toBe(frozenPrompt);
    expect(await service.schema(created.detail.request.id)).toEqual(frozenSchema);
  });

  it('fails closed when importing for an unsupported frozen schema version', async () => {
    const { handle, service } = await setup();
    const created = await service.create(brief);
    handle.client
      .prepare('UPDATE experience_research_requests SET schema_version = ? WHERE id = ?')
      .run('community-experience-bundle/v-next', created.detail.request.id);

    await expect(
      service.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
      }),
    ).rejects.toThrow(/Bundle Schema/u);
  });

  it('serializes same-revision bundle imports before file persistence', async () => {
    const { root, handle, service } = await setup();
    const created = await service.create(brief);
    const secondHandle = openSqliteDatabase({ dataRoot: root.path });
    const secondService = new ExperienceResearchService({
      repository: new SqliteInterviewResearchRepository(secondHandle.client),
      artifacts: new SqliteArtifactStore(secondHandle.client, root.path),
      clock: new TestClock(),
      ids: new SequentialIds(0xb000),
    });
    try {
      const attempts = await Promise.allSettled([
        service.importBundle({
          requestId: created.detail.request.id,
          expectedRevision: 0,
          bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
        }),
        secondService.importBundle({
          requestId: created.detail.request.id,
          expectedRevision: 0,
          bytes: new TextEncoder().encode(
            JSON.stringify(researchBundle('2026-08-30T08:01:00.000Z')),
          ),
        }),
      ]);

      expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejectedReasons = attempts.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : [],
      );
      expect(rejectedReasons).toHaveLength(1);
      expect(rejectedReasons[0]).toBeInstanceOf(ExperienceResearchConflictError);
      const detail = service.get(created.detail.request.id);
      expect(detail.request).toMatchObject({ revision: 1, bundleFileVersionNo: 1 });
      expect(
        handle.client
          .prepare('SELECT count(*) FROM file_entity_mappings WHERE file_id = ?')
          .pluck()
          .get(detail.request.bundleFileId),
      ).toBe(1);
      expect(
        handle.client
          .prepare(
            `SELECT count(*) FROM files
             WHERE kind = 'interview_research' AND id <> ? AND id <> ? AND id <> ?`,
          )
          .pluck()
          .get(
            detail.request.promptFileId,
            detail.request.schemaFileId,
            detail.request.bundleFileId,
          ),
      ).toBe(0);
      expect(
        handle.client
          .prepare(
            `SELECT bundle_import_token, bundle_import_claimed_at, bundle_import_file_id
             FROM experience_research_requests WHERE id = ?`,
          )
          .get(detail.request.id),
      ).toEqual({
        bundle_import_token: null,
        bundle_import_claimed_at: null,
        bundle_import_file_id: null,
      });
    } finally {
      secondHandle.close();
    }
  });

  it('compensates a failed finalize without retaining staging mappings or entities', async () => {
    const { handle, service } = await setup({ failFinalizeOnce: true });
    const created = await service.create(brief);

    await expect(
      service.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchConflictError);

    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM file_entity_mappings').pluck().get()).toBe(
      2,
    );
    expect(
      handle.client
        .prepare(
          `SELECT bundle_import_token, bundle_import_claimed_at, bundle_import_file_id
           FROM experience_research_requests WHERE id = ?`,
        )
        .get(created.detail.request.id),
    ).toEqual({
      bundle_import_token: null,
      bundle_import_claimed_at: null,
      bundle_import_file_id: null,
    });
  });

  it('reclaims an expired claim and its staging artifact', async () => {
    const { handle, repository, artifacts, clock, service } = await setup();
    const created = await service.create(brief);
    const claimedAt = clock.now();
    const staleToken = 'stale-import-claim';
    const staleFileId = contentHash({ requestId: created.detail.request.id, staleToken });
    expect(
      repository.claimBundleImport({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        claimToken: staleToken,
        stagingFileId: staleFileId,
        now: claimedAt,
        staleBefore: utcInstant(0),
      }),
    ).toBe(true);
    await artifacts.put({
      id: staleFileId,
      kind: 'interview_research',
      mediaType: 'application/json',
      content: new TextEncoder().encode(JSON.stringify(researchBundle())),
      createdAt: claimedAt,
      logicalFile: 'new',
    });
    clock.advance(5 * 60 * 1_000 + 1);

    const imported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 0,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
    });

    expect(imported.request).toMatchObject({ revision: 1, bundleFileVersionNo: 1 });
    expect(
      handle.client.prepare('SELECT count(*) FROM files WHERE id = ?').pluck().get(staleFileId),
    ).toBe(0);
    expect(
      handle.client
        .prepare('SELECT count(*) FROM file_entity_mappings WHERE file_id = ?')
        .pluck()
        .get(staleFileId),
    ).toBe(0);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(3);
  });

  it('commits the fifth distinct bundle but rejects a sixth before staging it', async () => {
    const { handle, service } = await setup();
    let detail = (await service.create(brief)).detail;
    for (let version = 1; version <= 5; version += 1) {
      detail = await service.importBundle({
        requestId: detail.request.id,
        expectedRevision: detail.request.revision,
        bytes: new TextEncoder().encode(
          JSON.stringify(researchBundle(`2026-08-30T08:0${String(version)}:00.000Z`)),
        ),
      });
      expect(detail.request.bundleFileVersionNo).toBe(version);
    }

    await expect(
      service.importBundle({
        requestId: detail.request.id,
        expectedRevision: detail.request.revision,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle('2026-08-30T08:06:00.000Z'))),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchConflictError);
    expect(
      handle.client
        .prepare('SELECT count(*) FROM file_entity_mappings WHERE file_id = ?')
        .pluck()
        .get(detail.request.bundleFileId),
    ).toBe(5);
    expect(
      handle.client
        .prepare(
          `SELECT count(*) FROM files
           WHERE kind = 'interview_research' AND id <> ? AND id <> ? AND id <> ?`,
        )
        .pluck()
        .get(detail.request.promptFileId, detail.request.schemaFileId, detail.request.bundleFileId),
    ).toBe(0);
  });

  it('persists the actual reviewed source URL instead of its tracking-free collection identity', async () => {
    const { handle, service } = await setup();
    const created = await service.create(brief);
    const value = researchBundle();
    const actualFinalUrl =
      'https://www.nowcoder.com/feed/main/detail/84f8d10f0b994be6aeeea786b63070d9?sourceSSR=search&utm_source=jobhunter';
    const trackedBundle: CommunityResearchBundle = {
      ...value,
      sources: [{ ...value.sources[0], url: actualFinalUrl }],
      experiences: [{ ...value.experiences[0], sourceUrl: actualFinalUrl }],
    };

    const imported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 0,
      bytes: new TextEncoder().encode(JSON.stringify(trackedBundle)),
    });

    expect(imported.experiences).toMatchObject([{ sourceUrl: actualFinalUrl }]);
    expect(
      handle.client
        .prepare('SELECT source_url FROM interview_experiences WHERE research_request_id = ?')
        .pluck()
        .get(created.detail.request.id),
    ).toBe(actualFinalUrl);
  });

  it('closes create, validate, version, review and accepted-history flow', async () => {
    const { handle, service } = await setup();
    const created = await service.create(brief);
    const replay = await service.create({ ...brief, targetRoles: [...brief.targetRoles] });

    expect(created).toMatchObject({ deduplicated: false, detail: { request: { revision: 0 } } });
    expect(replay).toMatchObject({
      deduplicated: true,
      detail: { request: { id: created.detail.request.id } },
    });
    expect(
      handle.client.prepare('SELECT count(*) FROM experience_research_requests').pluck().get(),
    ).toBe(1);
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);

    const invalid = { ...researchBundle(), requestFingerprint: '0'.repeat(64) };
    await expect(
      service.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        bytes: new TextEncoder().encode(JSON.stringify(invalid)),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchBundleError);
    expect(service.get(created.detail.request.id).experiences).toHaveLength(0);
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);

    const placeholder = researchBundle();
    await expect(
      service.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        bytes: new TextEncoder().encode(
          JSON.stringify({
            ...placeholder,
            sources: [{ ...placeholder.sources[0], title: '实时网页搜索不可用' }],
            experiences: [
              {
                ...placeholder.experiences[0],
                questions: [
                  {
                    text: '未能检索到可核验的公开面经',
                    answerExcerpt: null,
                    topics: [],
                    evidenceExcerpt: '没有找到有效来源或研究结果',
                  },
                ],
              },
            ],
            warnings: ['当前环境无法进行联网检索。'],
          }),
        ),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchBundleError);
    expect(service.get(created.detail.request.id).experiences).toHaveLength(0);
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);

    const imported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 0,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
    });
    expect(imported.request).toMatchObject({
      state: 'needs_review',
      revision: 1,
      bundleFileVersionNo: 1,
    });
    expect(imported.experiences).toHaveLength(2);
    expect(imported.questions).toHaveLength(2);
    expect(imported.warnings).toEqual(['部分来源没有标注确切面试日期。']);
    expect(
      imported.occurrenceCounts[communityQuestionFingerprint('如何定位一次线上慢查询？')],
    ).toBe(2);
    expect(
      handle.client
        .prepare('SELECT answer, answer_excerpt FROM interview_question_entries LIMIT 1')
        .get(),
    ).toMatchObject({ answer: null, answer_excerpt: '原文提到先查执行计划。' });

    const reimported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 1,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle('2026-08-30T09:00:00.000Z'))),
    });
    expect(reimported.request).toMatchObject({ revision: 2, bundleFileVersionNo: 2 });
    expect(
      handle.client
        .prepare('SELECT count(*) FROM file_entity_mappings WHERE file_id = ?')
        .pluck()
        .get(reimported.request.bundleFileId),
    ).toBe(2);

    const first = reimported.experiences[0];
    const second = reimported.experiences[1];
    if (!first || !second) throw new Error('Expected two research candidates.');
    const oneReviewed = service.review({
      requestId: reimported.request.id,
      experienceId: first.id,
      expectedRevision: 2,
      decision: 'accept',
    });
    expect(oneReviewed.request).toMatchObject({ state: 'needs_review', revision: 3 });
    const completed = service.review({
      requestId: reimported.request.id,
      experienceId: second.id,
      expectedRevision: 3,
      decision: 'accept',
    });
    expect(completed.request).toMatchObject({ state: 'completed', revision: 4 });

    const accepted = service.listAccepted();
    expect(accepted).toHaveLength(2);
    expect(service.listAccepted({ company: '示例科技' })).toHaveLength(2);
    expect(service.listAccepted({ role: '后端工程师', stage: '一面' })).toMatchObject([
      { experience: { stage: '一面' } },
    ]);
    expect(service.listAccepted({ stage: '终面' })).toHaveLength(0);
    expect(() => service.listAccepted({ company: '   ' })).toThrow(TypeError);
    expect(
      accepted.every(
        (item) =>
          item.occurrenceCounts[communityQuestionFingerprint('如何定位一次线上慢查询？')] === 2,
      ),
    ).toBe(true);
    await expect(
      service.importBundle({
        requestId: completed.request.id,
        expectedRevision: 4,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchConflictError);
    expect(() =>
      service.enqueueExecution({
        requestId: completed.request.id,
        executorKey: 'codex-local',
        idempotencyToken: 'accepted-request-must-fork',
      }),
    ).toThrow(ExperienceResearchConflictError);

    const nextGeneration = await service.create(brief);
    const nextReplay = await service.create(brief);
    expect(nextGeneration).toMatchObject({ deduplicated: false });
    expect(nextGeneration.detail.request.id).not.toBe(completed.request.id);
    expect(nextGeneration.detail.request.requestFingerprint).not.toBe(
      completed.request.requestFingerprint,
    );
    expect(nextReplay).toMatchObject({
      deduplicated: true,
      detail: { request: { id: nextGeneration.detail.request.id } },
    });
  });

  it('allows a reviewed request to be replaced only when every candidate was rejected', async () => {
    const { service } = await setup();
    const created = await service.create(brief);
    const imported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 0,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
    });
    const first = imported.experiences[0];
    const second = imported.experiences[1];
    if (!first || !second) throw new Error('Expected two research candidates.');

    const oneRejected = service.review({
      requestId: imported.request.id,
      experienceId: first.id,
      expectedRevision: 1,
      decision: 'reject',
    });
    const allRejected = service.review({
      requestId: imported.request.id,
      experienceId: second.id,
      expectedRevision: oneRejected.request.revision,
      decision: 'reject',
    });
    expect(allRejected.request).toMatchObject({
      state: 'completed',
      revision: 3,
      bundleFileVersionNo: 1,
    });

    const replacement = await service.importBundle({
      requestId: allRejected.request.id,
      expectedRevision: allRejected.request.revision,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle('2026-08-30T10:00:00.000Z'))),
    });
    expect(replacement.request).toMatchObject({
      state: 'needs_review',
      revision: 4,
      bundleFileVersionNo: 2,
    });
    expect(replacement.experiences.every((item) => item.reviewStatus === 'needs_review')).toBe(
      true,
    );
  });

  it('re-enqueues research after every candidate is rejected and exposes the current task', async () => {
    const { service, tasks } = await setup();
    const created = await service.create(brief);
    const imported = await service.importBundle({
      requestId: created.detail.request.id,
      expectedRevision: 0,
      bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
    });
    let detail = imported;
    for (const experience of imported.experiences) {
      detail = service.review({
        requestId: imported.request.id,
        experienceId: experience.id,
        expectedRevision: detail.request.revision,
        decision: 'reject',
      });
    }

    const execution = service.enqueueExecution({
      requestId: detail.request.id,
      executorKey: 'codex-local',
      idempotencyToken: 'all-rejected-research-retry',
    });
    expect(execution).toMatchObject({ deduplicated: false, task: { status: 'pending' } });
    expect(service.get(detail.request.id).request).toMatchObject({
      state: 'ready',
      revision: detail.request.revision,
      currentTaskId: execution.task.id,
    });
    expect(service.listRequests()).toMatchObject([
      {
        request: { id: detail.request.id },
        currentTask: { id: execution.task.id, status: 'pending' },
      },
    ]);

    expect(tasks.cancel(execution.task.id)).toMatchObject({
      kind: 'cancelled',
      task: { status: 'cancelled' },
    });
    expect(service.listRequests()[0]?.currentTask).toMatchObject({ status: 'cancelled' });
  });

  it('publishes the same research task idempotently without replacing its attachment', async () => {
    const { handle, service } = await setup();
    const created = await service.create(brief);
    const command = {
      requestId: created.detail.request.id,
      executorKey: 'codex-local' as const,
      idempotencyToken: 'same-research-publication',
    };

    const first = service.enqueueExecution(command);
    const replay = service.enqueueExecution(command);

    expect(first).toMatchObject({ deduplicated: false, task: { status: 'pending' } });
    expect(replay).toMatchObject({ deduplicated: true, task: { id: first.task.id } });
    expect(service.get(created.detail.request.id).request.currentTaskId).toBe(first.task.id);
    expect(handle.client.prepare('SELECT count(*) FROM tasks').pluck().get()).toBe(1);
  });

  it('atomically relinks a failed research request to its manual retry task', async () => {
    const { repository, service, queue, tasks, clock } = await setup();
    const created = await service.create(brief);
    const failed = service.enqueueExecution({
      requestId: created.detail.request.id,
      executorKey: 'codex-local',
      idempotencyToken: 'initial-research-task',
    }).task;
    queue.claim({
      taskType: failed.taskType,
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 120_000,
    });
    queue.fail({
      taskId: failed.id,
      workerId: 'worker-a',
      finishedAt: clock.now(),
      category: 'permanent',
      summary: 'fixture failure',
    });

    const retry = tasks.retryFailed(failed.id, 'manual-research-retry');

    expect(retry).toMatchObject({ kind: 'enqueued', task: { retryOfTaskId: failed.id } });
    expect(repository.getRequest(created.detail.request.id)?.request.currentTaskId).toBe(
      retry.task.id,
    );
    expect(service.listRequests()[0]?.currentTask).toMatchObject({
      id: retry.task.id,
      status: 'pending',
    });
  });

  it('rejects an automatic import when cancellation was requested before its claim', async () => {
    const { handle, service, queue, clock, tasks } = await setup();
    const created = await service.create(brief);
    const execution = service.enqueueExecution({
      requestId: created.detail.request.id,
      executorKey: 'codex-local',
      idempotencyToken: 'cancel-before-import-claim',
    });
    const running = queue.claim({
      taskType: 'interview.experience-research.execute',
      workerId: 'research-cancel-test',
      now: clock.now(),
      leaseDurationMsFor: () => 20 * 60_000,
    });
    expect(running?.id).toBe(execution.task.id);
    expect(tasks.cancel(execution.task.id)).toMatchObject({ kind: 'cancel_requested' });

    await expect(
      service.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        taskId: execution.task.id,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchConflictError);

    expect(service.get(created.detail.request.id)).toMatchObject({
      request: {
        state: 'ready',
        revision: 0,
        bundleFileId: null,
        bundleFileVersionNo: null,
      },
      experiences: [],
    });
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);
  });

  it('removes a staged automatic bundle when cancellation wins before finalize', async () => {
    const { handle, repository, artifacts, service, queue, clock, tasks } = await setup();
    const created = await service.create(brief);
    const execution = service.enqueueExecution({
      requestId: created.detail.request.id,
      executorKey: 'codex-local',
      idempotencyToken: 'cancel-before-import-finalize',
    });
    const running = queue.claim({
      taskType: 'interview.experience-research.execute',
      workerId: 'research-cancel-test',
      now: clock.now(),
      leaseDurationMsFor: () => 20 * 60_000,
    });
    expect(running?.id).toBe(execution.task.id);
    let runningTaskId: TaskId | null = execution.task.id;
    const cancellingArtifacts: ArtifactStore = {
      async put(input) {
        const stored = await artifacts.put(input);
        if (input.name?.endsWith('-bundle-pending.json')) {
          const taskId = runningTaskId;
          if (!taskId) throw new Error('Expected a running research task.');
          expect(tasks.cancel(taskId)).toMatchObject({ kind: 'cancel_requested' });
          runningTaskId = null;
        }
        return stored;
      },
      read: (input) => artifacts.read(input),
      resolve: (relativePath) => artifacts.resolve(relativePath),
      quarantine: (artifactId, relativePath) => artifacts.quarantine(artifactId, relativePath),
      restoreQuarantined: (artifact) => artifacts.restoreQuarantined(artifact),
      purgeQuarantined: (artifact) => artifacts.purgeQuarantined(artifact),
    };
    const importingService = new ExperienceResearchService({
      repository,
      artifacts: cancellingArtifacts,
      clock,
      ids: new SequentialIds(0xc000),
    });

    await expect(
      importingService.importBundle({
        requestId: created.detail.request.id,
        expectedRevision: 0,
        taskId: execution.task.id,
        bytes: new TextEncoder().encode(JSON.stringify(researchBundle())),
      }),
    ).rejects.toBeInstanceOf(ExperienceResearchConflictError);

    expect(service.get(created.detail.request.id)).toMatchObject({
      request: {
        state: 'ready',
        revision: 0,
        bundleFileId: null,
        bundleFileVersionNo: null,
      },
      experiences: [],
    });
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'interview_research'")
        .pluck()
        .get(),
    ).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(2);
    expect(handle.client.prepare('SELECT count(*) FROM file_entity_mappings').pluck().get()).toBe(
      2,
    );
    expect(
      handle.client
        .prepare(
          `SELECT bundle_import_token, bundle_import_claimed_at, bundle_import_file_id
           FROM experience_research_requests WHERE id = ?`,
        )
        .get(created.detail.request.id),
    ).toEqual({
      bundle_import_token: null,
      bundle_import_claimed_at: null,
      bundle_import_file_id: null,
    });
  });

  it.each(['codex-local', 'browser-assisted-codex'] as const)(
    'routes the %s executor result through the same validated bundle importer',
    async (executorKey) => {
      const { repository, service, queue, clock } = await setup();
      const created = await service.create(brief);
      const execution = service.enqueueExecution({
        requestId: created.detail.request.id,
        executorKey,
        idempotencyToken: `handler-research-execution-${executorKey}`,
      });
      const running = queue.claim({
        taskType: 'interview.experience-research.execute',
        workerId: 'research-handler-test',
        now: clock.now(),
        leaseDurationMsFor: () => 20 * 60_000,
      });
      expect(running?.id).toBe(execution.task.id);
      let receivedPrompt = '';
      const executor: ExternalResearchExecutor = {
        key: executorKey,
        version: 'fixture-v1',
        supportedPromptVersions: [created.detail.request.promptVersion],
        capabilitySummary: {
          liveWebSearch: executorKey === 'codex-local',
          browserTools: [],
          sandbox:
            executorKey === 'browser-assisted-codex'
              ? 'isolated-evidence-local-process'
              : 'web-search-only-local-process',
        },
        execute(input) {
          receivedPrompt = input.prompt;
          expect(input.requestId).toBe(created.detail.request.id);
          expect(input.promptVersion).toBe(created.detail.request.promptVersion);
          expect(input.maximumOutputBytes).toBe(2 * 1024 * 1024);
          expect(input.outputSchema).toMatchObject({ type: 'object' });
          expect(input.collectionPlan).toEqual({
            version: 'community-browser-collection@v2',
            queries: [
              'site:nowcoder.com 后端工程师 面经 面试 技术问题',
              '示例科技 后端工程师 面经 面试 技术问题',
              '后端工程师 面经 面试 技术问题',
            ],
            priorityQueryCount: 1,
            relevanceTerms: ['后端工程师', '后端'],
            maximumSources: 3,
          });
          expect(input.browserPolicy).toEqual({
            allowedDomains: ['nowcoder.com'],
            blockedDomains: [],
            maximumSearches: 3,
            maximumPages: 6,
            maximumReadCalls: 6,
            maximumPageCharacters: 40_000,
            maximumTotalCharacters: 120_000,
            navigationTimeoutMs: 20_000,
          });
          return Promise.resolve({
            bundleText: JSON.stringify(researchBundle()),
            externalSessionId: 'fixture-session',
            diagnosticSummary: null,
          });
        },
      };
      const unusedExecutor: ExternalResearchExecutor = {
        ...executor,
        key: executorKey === 'codex-local' ? 'browser-assisted-codex' : 'codex-local',
        capabilitySummary:
          executorKey === 'codex-local'
            ? {
                liveWebSearch: false,
                browserTools: [],
                sandbox: 'isolated-evidence-local-process',
              }
            : {
                liveWebSearch: true,
                browserTools: [],
                sandbox: 'web-search-only-local-process',
              },
        execute() {
          throw new Error('Handler selected the wrong research executor fixture.');
        },
      };
      const registry = new HandlerRegistry();
      registry.register(
        createExperienceResearchTaskHandler({
          repository,
          service,
          executors: [unusedExecutor, executor],
        }),
      );
      const output = await registry.execute(
        'interview.experience-research.execute',
        {
          taskId: execution.task.id,
          signal: new AbortController().signal,
          clock: new TestClock(),
          logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
          services: {},
        },
        {
          requestId: created.detail.request.id,
          requestFingerprint: created.detail.request.requestFingerprint,
          expectedRevision: 0,
          executorKey,
        },
      );

      expect(receivedPrompt).toContain(created.detail.request.requestFingerprint);
      expect(output).toMatchObject({
        requestId: created.detail.request.id,
        bundleFileVersionNo: 1,
        candidateCount: 2,
        externalSessionId: 'fixture-session',
      });
      expect(service.get(created.detail.request.id)).toMatchObject({
        request: { state: 'needs_review', revision: 1 },
        experiences: [{ reviewStatus: 'needs_review' }, { reviewStatus: 'needs_review' }],
      });
    },
  );
});
