import {
  createProjectAnswerDigestTaskHandler,
  createProjectNotebookTaskHandler,
  createProjectQuestionTaskHandler,
  HandlerRegistry,
  InterviewProjectService,
  TaskService,
  type ArtifactStore,
  type TaskLogger,
} from '@jobhunter/application';
import { AgentRunner, type ModelClient } from '@jobhunter/agent-core';
import { contentHash, SystemIdGenerator, utcInstant } from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  SqliteArtifactStore,
  SqliteCandidateProfileRepository,
  SqliteInterviewProjectRepository,
  SqliteInterviewResearchRepository,
  SqliteInterviewTaskPublisher,
  SqliteInterviewTaskRetryCoordinator,
  SqliteProjectNotebookReader,
  SqliteTaskRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

const roots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});

const silentLogger: TaskLogger = {
  info(event, fields) {
    void event;
    void fields;
  },
  warn(event, fields) {
    void event;
    void fields;
  },
  error(event, fields) {
    void event;
    void fields;
  },
};

/** 构造测试输入或执行断言的辅助逻辑。 */
function model(): ModelClient {
  return {
    metadata: {
      provider: 'fixture',
      model: 'fixture',
      config: {},
      costCurrency: 'USD',
      pricingVersion: 'fixture',
    },
    complete(request) {
      if (request.outputSchemaName === 'project_interview_question') {
        const input = request.input as {
          allowedEvidenceRefs: readonly { readonly kind: string; readonly id: string }[];
        };
        return Promise.resolve({
          kind: 'output',
          output: {
            question: '这个项目最初要解决什么问题，你如何判断目标已经达成？',
            intent: '确认项目背景和成功标准。',
            primaryDimension: 'background_goal',
            guidanceSlots: ['业务背景', '目标用户', '成功标准'],
            evidenceRefs: [input.allowedEvidenceRefs[0]],
          },
          usage: { inputTokens: 100, outputTokens: 40, estimatedCostMicros: 10 },
        });
      }
      const input = request.input as { answer: string };
      return Promise.resolve({
        kind: 'output',
        output: {
          knowledgeItems: [
            {
              kind: 'metric',
              statement: '接口延迟从 300ms 降到 80ms',
              quote: input.answer,
              start: 0,
              end: input.answer.length,
            },
          ],
          coverageUpdates: [
            {
              dimension: 'data_metrics',
              status: 'evidence_sufficient',
              evidenceItemIndexes: [0],
            },
          ],
        },
        usage: { inputTokens: 100, outputTokens: 40, estimatedCostMicros: 10 },
      });
    },
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function seedProfile(handle: SqliteDatabaseHandle): {
  profileVersionId: string;
  projectHash: string;
} {
  const profileId = '018f0000-0000-7000-8000-000000000301';
  const profileVersionId = '018f0000-0000-7000-8000-000000000302';
  const project = {
    name: 'JobHunter',
    role: '核心开发者',
    startDate: '2026-01',
    endDate: null,
    highlights: ['实现本地职位同步与面试准备'],
    evidence: [{ source: 'resume', quote: 'JobHunter 项目' }],
  };
  const profile = {
    basicInfo: { name: '测试用户', phone: null, email: null, location: null, website: null },
    targetRoles: ['研发'],
    preferences: {
      locations: [],
      companySizes: [],
      employmentTypes: [],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [project],
    works: [],
    competitions: [],
    certificates: [],
    languages: [],
    professionalSkills: null,
    selfEvaluation: null,
    skills: [],
    domains: [],
    yearsOfExperience: null,
    managementExperience: null,
  };
  handle.client
    .prepare(
      'INSERT INTO candidate_profiles (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)',
    )
    .run(profileId, '测试用户');
  handle.client
    .prepare(
      `INSERT INTO profile_versions
       (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
        content_hash, is_current, created_at) VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
    )
    .run(
      profileVersionId,
      profileId,
      JSON.stringify(profile),
      JSON.stringify(profile),
      contentHash(profile),
    );
  return { profileVersionId, projectHash: contentHash(project) };
}

describe('interview project workflow', () => {
  it('runs one Web-enqueued question, answer digest, projection and dossier deletion', async () => {
    const root = await createTemporaryDataRoot('jobhunter-interview-workflow-');
    roots.push(root);
    const handle = openSqliteDatabase({ dataRoot: root.path });
    handles.push(handle);
    const seeded = seedProfile(handle);
    const ids = new SystemIdGenerator();
    const clock = { now: () => utcInstant(1_800_000_000_000) };
    const repository = new SqliteInterviewProjectRepository(handle.client);
    const profiles = new SqliteCandidateProfileRepository(handle.client);
    const artifacts = new SqliteArtifactStore(handle.client, root.path);
    const queue = new SqliteTaskRepository(handle.client);
    const registry = new HandlerRegistry();
    const runner = new AgentRunner({
      store: new SqliteAgentRunStore(handle.client),
      model: model(),
      createId: () => ids.generate(),
      now: () => clock.now(),
    });
    const serviceRef: { current: InterviewProjectService | null } = { current: null };
    const enqueueNotebook = (dossierId: string): void => {
      if (!serviceRef.current) throw new Error('Interview project service is unavailable.');
      serviceRef.current.enqueueNotebook(dossierId);
    };
    registry.register(
      createProjectQuestionTaskHandler({ runner, repository, onCommitted: enqueueNotebook }),
    );
    registry.register(
      createProjectAnswerDigestTaskHandler({
        runner,
        repository,
        ids,
        onCommitted: enqueueNotebook,
      }),
    );
    registry.register(createProjectNotebookTaskHandler({ repository, artifacts, ids }));
    const tasks = new TaskService(
      { queue, clock, ids },
      registry,
      null,
      new SqliteInterviewTaskRetryCoordinator(handle.client, queue),
    );
    const taskPublisher = new SqliteInterviewTaskPublisher({
      client: handle.client,
      tasks,
      projects: repository,
      research: new SqliteInterviewResearchRepository(handle.client),
    });
    const service = new InterviewProjectService({
      profiles,
      repository,
      tasks,
      taskPublisher,
      clock,
      ids,
      artifacts,
      notebooks: new SqliteProjectNotebookReader(handle.client, root.path),
    });
    serviceRef.current = service;
    const created = service.createDossier({
      profileVersionId: seeded.profileVersionId,
      projectIndex: 0,
      expectedProjectHash: seeded.projectHash,
    });
    const started = service.startSession(created.dossier.dossier.id);

    const initialNotebook = tasks.list({ taskType: 'interview.project-notebook.render' })[0];
    if (!initialNotebook) throw new Error('Initial notebook task was not enqueued.');

    const failedQuestionTask = service.requestQuestion(started.sessionId).task;
    queue.claim({
      taskType: failedQuestionTask.taskType,
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 120_000,
    });
    queue.fail({
      taskId: failedQuestionTask.id,
      workerId: 'worker-a',
      finishedAt: clock.now(),
      category: 'permanent',
      summary: 'fixture failure',
    });
    const questionRetry = tasks.retryFailed(failedQuestionTask.id, 'question-retry');
    expect(service.getDossier(created.dossier.dossier.id).turns[0]?.questionTaskId).toBe(
      questionRetry.task.id,
    );
    const questionTask = queue.claim({
      taskType: failedQuestionTask.taskType,
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 120_000,
    });
    if (!questionTask) throw new Error('Question retry was not claimed.');
    await registry.execute(
      questionTask.taskType,
      {
        taskId: questionTask.id,
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      questionTask.payload,
    );
    const pendingNotebooks = tasks.list({
      taskType: 'interview.project-notebook.render',
      statuses: ['pending'],
    });
    expect(pendingNotebooks).toHaveLength(2);
    const questioned = service.getDossier(created.dossier.dossier.id);
    const turn = questioned.turns[0];
    if (!turn) throw new Error('Question turn was not created.');
    expect(turn).toMatchObject({ status: 'awaiting_answer', primaryDimension: 'background_goal' });

    const answer = '接口延迟从 300ms 降到 80ms';
    const answerToken = 'answer-token-1';
    expect(() =>
      service.submitAnswer({
        sessionId: started.sessionId,
        turnId: turn.id,
        answer,
        idempotencyToken: answerToken,
      }),
    ).toThrow(/仍在收尾/u);
    expect(service.getDossier(created.dossier.dossier.id)).toMatchObject({
      answers: [{ answer }],
      turns: [{ status: 'digest_pending', digestTaskId: null }],
    });
    queue.complete(questionTask.id, 'worker-a', clock.now());
    expect(service.getDossier(created.dossier.dossier.id).turns[0]).toMatchObject({
      status: 'digest_pending',
      digestTaskId: null,
    });
    const failedDigestTask = service.submitAnswer({
      sessionId: started.sessionId,
      turnId: turn.id,
      answer,
      idempotencyToken: answerToken,
    }).task;
    expect(
      service.submitAnswer({
        sessionId: started.sessionId,
        turnId: turn.id,
        answer,
        idempotencyToken: answerToken,
      }),
    ).toMatchObject({ task: { id: failedDigestTask.id }, deduplicated: true });
    queue.claim({
      taskType: failedDigestTask.taskType,
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 120_000,
    });
    queue.fail({
      taskId: failedDigestTask.id,
      workerId: 'worker-a',
      finishedAt: clock.now(),
      category: 'permanent',
      summary: 'fixture failure',
    });
    const digestRetry = tasks.retryFailed(failedDigestTask.id, 'digest-retry');
    expect(service.getDossier(created.dossier.dossier.id).turns[0]?.digestTaskId).toBe(
      digestRetry.task.id,
    );
    const digestTask = queue.claim({
      taskType: failedDigestTask.taskType,
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 120_000,
    });
    if (!digestTask) throw new Error('Digest retry was not claimed.');
    await registry.execute(
      digestTask.taskType,
      {
        taskId: digestTask.id,
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      digestTask.payload,
    );
    const taskCountBeforeCrossStageRetry = tasks.count({});
    expect(() => tasks.retryFailed(failedQuestionTask.id, 'question-retry-after-digest')).toThrow(
      /Another task is active/u,
    );
    expect(tasks.count({})).toBe(taskCountBeforeCrossStageRetry);
    expect(service.getDossier(created.dossier.dossier.id).turns[0]).toMatchObject({
      questionTaskId: questionRetry.task.id,
      digestTaskId: digestTask.id,
    });
    expect(() => service.requestQuestion(started.sessionId)).toThrow(/仍在收尾/u);
    expect(service.getDossier(created.dossier.dossier.id).turns).toHaveLength(1);
    queue.complete(digestTask.id, 'worker-a', clock.now());

    const revisedAnswer = '接口延迟从 300ms 降到 80ms，并连续观察七天。';
    const revisionTask = service.submitAnswer({
      sessionId: started.sessionId,
      turnId: turn.id,
      answer: revisedAnswer,
      idempotencyToken: 'answer-token-2',
    }).task;
    handle.client.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(revisionTask.id);
    await registry.execute(
      revisionTask.taskType,
      {
        taskId: revisionTask.id,
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      revisionTask.payload,
    );
    handle.client
      .prepare("UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE id = ?")
      .run(clock.now(), revisionTask.id);

    for (const stale of tasks.list({
      taskType: 'interview.project-notebook.render',
      statuses: ['pending'],
    })) {
      await registry.execute(
        stale.taskType,
        {
          signal: new AbortController().signal,
          clock,
          logger: silentLogger,
          services: {},
        },
        stale.payload,
      );
      handle.client
        .prepare("UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE id = ?")
        .run(clock.now(), stale.id);
    }
    const latestNotebook = service.enqueueNotebook(created.dossier.dossier.id).task;
    await registry.execute(
      latestNotebook.taskType,
      {
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      latestNotebook.payload,
    );

    const completed = service.getDossier(created.dossier.dossier.id);
    expect(completed.turns[0]?.status).toBe('ready');
    expect(completed.answers.map((item) => item.answer)).toEqual([answer, revisedAnswer]);
    expect(completed.knowledgeItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quote: answer, status: 'superseded' }),
        expect.objectContaining({ quote: revisedAnswer, status: 'active' }),
      ]),
    );
    expect(completed.coverage.find((item) => item.dimension === 'data_metrics')?.status).toBe(
      'evidence_sufficient',
    );
    expect(completed.dossier.latestNotebookArtifactId).not.toBeNull();
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(1);
    const artifact = handle.client
      .prepare(
        `SELECT entity.relative_path
         FROM file_entity_mappings mapping
         JOIN entities entity ON entity.id = mapping.entity_id
         WHERE mapping.file_id = ?
         ORDER BY mapping.version_no DESC LIMIT 1`,
      )
      .get(completed.dossier.latestNotebookArtifactId) as { relative_path: string };
    const markdown = await readFile(artifacts.resolve(artifact.relative_path), 'utf8');
    expect(markdown).toContain('这个项目最初要解决什么问题');
    expect(markdown).toContain(answer);
    expect(markdown).toContain(revisedAnswer);
    expect(markdown).toContain('不包含标准答案');
    const download = await service.readNotebook(
      created.dossier.dossier.id,
      new AbortController().signal,
    );
    expect(download).toMatchObject({
      filename: 'JobHunter-interview-notebook.md',
      mediaType: 'text/markdown; charset=utf-8',
    });
    expect(new TextDecoder().decode(download.content)).toBe(markdown);

    const firstMaterialBytes = new TextEncoder().encode('# 架构\n\n第一版采用事件驱动。');
    const firstMaterial = await service.importMaterial({
      dossierId: created.dossier.dossier.id,
      fileName: 'architecture.md',
      bytes: firstMaterialBytes,
      signal: new AbortController().signal,
    });
    const firstMaterialPath = handle.client
      .prepare('SELECT relative_path FROM entities WHERE id = ?')
      .pluck()
      .get(firstMaterial.material.entityId) as string;
    const secondMaterialBytes = new TextEncoder().encode('# 架构\n\n第二版改为模块化单体。');
    const secondMaterial = await service.importMaterial({
      dossierId: created.dossier.dossier.id,
      fileName: 'architecture.md',
      bytes: secondMaterialBytes,
      signal: new AbortController().signal,
    });
    const sharedFile = await artifacts.put({
      id: ids.generate(),
      kind: 'export',
      name: 'shared-architecture.md',
      mediaType: 'text/markdown; charset=utf-8',
      content: secondMaterialBytes,
      createdAt: clock.now(),
      logicalFile: 'new',
    });
    expect(sharedFile.entityId).toBe(secondMaterial.material.entityId);

    const deletion = service.previewDeletion(created.dossier.dossier.id);
    expect(deletion.counts).toMatchObject({
      notebookArtifacts: 1,
      materialFiles: 1,
      materialArtifacts: 1,
    });
    expect(deletion.snapshot.materialFileIds).toEqual([firstMaterial.material.fileId]);
    expect(deletion.snapshot.materialArtifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstMaterial.material.entityId, shared: false }),
        expect.objectContaining({ id: secondMaterial.material.entityId, shared: true }),
      ]),
    );

    const deleted = await service.deleteConfirmed({
      dossierId: created.dossier.dossier.id,
      expectedImpactHash: deletion.impactHash,
    });
    expect(deleted).toMatchObject({
      pendingArtifactPurgeId: null,
      pendingArtifactPurgeIds: [],
    });
    expect(repository.getDossier(created.dossier.dossier.id)).toBeNull();
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'project_material'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(handle.client.prepare('SELECT id, deleted_at FROM entities ORDER BY id').all()).toEqual([
      { id: sharedFile.entityId, deleted_at: null },
    ]);
    expect(
      handle.client.prepare('SELECT count(*) FROM files WHERE id = ?').pluck().get(sharedFile.id),
    ).toBe(1);
    await expect(readFile(artifacts.resolve(firstMaterialPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(artifacts.resolve(sharedFile.relativePath), 'utf8')).toBe(
      new TextDecoder().decode(secondMaterialBytes),
    );
  });

  it('unregisters a notebook artifact when its dossier revision loses the final CAS', async () => {
    const root = await createTemporaryDataRoot('jobhunter-interview-notebook-cas-');
    roots.push(root);
    const handle = openSqliteDatabase({ dataRoot: root.path });
    handles.push(handle);
    const seeded = seedProfile(handle);
    const ids = new SystemIdGenerator();
    const clock = { now: () => utcInstant(1_800_000_000_000) };
    const repository = new SqliteInterviewProjectRepository(handle.client);
    const artifacts = new SqliteArtifactStore(handle.client, root.path);
    const registry = new HandlerRegistry();
    registry.register(createProjectNotebookTaskHandler({ repository, artifacts, ids }));
    const queue = new SqliteTaskRepository(handle.client);
    const tasks = new TaskService({ queue, clock, ids }, registry);
    const service = new InterviewProjectService({
      profiles: new SqliteCandidateProfileRepository(handle.client),
      repository,
      tasks,
      taskPublisher: new SqliteInterviewTaskPublisher({
        client: handle.client,
        tasks,
        projects: repository,
        research: new SqliteInterviewResearchRepository(handle.client),
      }),
      clock,
      ids,
      artifacts,
    });
    const created = service.createDossier({
      profileVersionId: seeded.profileVersionId,
      projectIndex: 0,
      expectedProjectHash: seeded.projectHash,
    });
    const staleRevision = created.dossier.dossier.revision;
    const stale = await artifacts.put({
      id: ids.generate(),
      kind: 'project_notebook',
      name: `${created.dossier.dossier.id}.md`,
      mediaType: 'text/markdown; charset=utf-8',
      content: new TextEncoder().encode('# 已过期的面试准备投影\n'),
      createdAt: clock.now(),
      logicalFile: 'new',
    });
    service.startSession(created.dossier.dossier.id);

    expect(
      repository.updateNotebook({
        dossierId: created.dossier.dossier.id,
        expectedRevision: staleRevision,
        artifactId: stale.id,
        sourceHash: contentHash('stale-notebook'),
        now: clock.now(),
      }),
    ).toBe(false);
    expect(
      handle.client.prepare('SELECT count(*) FROM files WHERE id = ?').pluck().get(stale.id),
    ).toBe(0);
    expect(
      handle.client
        .prepare('SELECT count(*) FROM file_entity_mappings WHERE file_id = ?')
        .pluck()
        .get(stale.id),
    ).toBe(0);
    expect(
      handle.client
        .prepare('SELECT count(*) FROM entities WHERE id = ?')
        .pluck()
        .get(stale.entityId),
    ).toBe(0);
    expect(await readFile(artifacts.resolve(stale.relativePath), 'utf8')).toContain('已过期');
  });

  it('does not publish a notebook cancelled while its artifact is being written', async () => {
    const root = await createTemporaryDataRoot('jobhunter-interview-notebook-cancel-');
    roots.push(root);
    const handle = openSqliteDatabase({ dataRoot: root.path });
    handles.push(handle);
    const seeded = seedProfile(handle);
    const ids = new SystemIdGenerator();
    const clock = { now: () => utcInstant(1_800_000_000_000) };
    const repository = new SqliteInterviewProjectRepository(handle.client);
    const artifacts = new SqliteArtifactStore(handle.client, root.path);
    let releasePut: (() => void) | null = null;
    let notifyPutStarted: (() => void) | null = null;
    const putStarted = new Promise<void>((resolve) => {
      notifyPutStarted = resolve;
    });
    const putReleased = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    const gatedArtifacts: ArtifactStore = {
      async put(input) {
        notifyPutStarted?.();
        await putReleased;
        return artifacts.put(input);
      },
      read: (input) => artifacts.read(input),
      resolve: (relativePath) => artifacts.resolve(relativePath),
      quarantine: (artifactId, relativePath) => artifacts.quarantine(artifactId, relativePath),
      restoreQuarantined: (artifact) => artifacts.restoreQuarantined(artifact),
      purgeQuarantined: (artifact) => artifacts.purgeQuarantined(artifact),
    };
    const registry = new HandlerRegistry();
    registry.register(
      createProjectNotebookTaskHandler({ repository, artifacts: gatedArtifacts, ids }),
    );
    const queue = new SqliteTaskRepository(handle.client);
    const tasks = new TaskService({ queue, clock, ids }, registry);
    const service = new InterviewProjectService({
      profiles: new SqliteCandidateProfileRepository(handle.client),
      repository,
      tasks,
      taskPublisher: new SqliteInterviewTaskPublisher({
        client: handle.client,
        tasks,
        projects: repository,
        research: new SqliteInterviewResearchRepository(handle.client),
      }),
      clock,
      ids,
      artifacts,
    });
    const created = service.createDossier({
      profileVersionId: seeded.profileVersionId,
      projectIndex: 0,
      expectedProjectHash: seeded.projectHash,
    });
    service.startSession(created.dossier.dossier.id);
    const task = queue.claim({
      taskType: 'interview.project-notebook.render',
      workerId: 'worker-a',
      now: clock.now(),
      leaseDurationMsFor: () => 60_000,
    });
    if (!task) throw new Error('Notebook task was not claimed.');
    const controller = new AbortController();
    const execution = registry.execute(
      task.taskType,
      {
        taskId: task.id,
        signal: controller.signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      task.payload,
    );
    await putStarted;
    expect(queue.cancel(task.id, clock.now()).kind).toBe('cancel_requested');
    controller.abort('cancelled');
    releasePut?.();

    await expect(execution).rejects.toMatchObject({ category: 'cancelled' });
    expect(repository.getDossier(created.dossier.dossier.id)?.dossier).toMatchObject({
      latestNotebookArtifactId: null,
      notebookSourceHash: null,
    });
    expect(
      handle.client
        .prepare("SELECT count(*) FROM files WHERE kind = 'project_notebook'")
        .pluck()
        .get(),
    ).toBe(0);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(0);
  });

  it('keeps concurrent same-name uploads idempotent and on one logical file', async () => {
    const root = await createTemporaryDataRoot('jobhunter-interview-material-race-');
    roots.push(root);
    const firstHandle = openSqliteDatabase({ dataRoot: root.path });
    handles.push(firstHandle);
    const seeded = seedProfile(firstHandle);
    const clock = { now: () => utcInstant(1_800_000_000_000) };

    const createService = (handle: SqliteDatabaseHandle): InterviewProjectService => {
      const ids = new SystemIdGenerator();
      const repository = new SqliteInterviewProjectRepository(handle.client);
      const tasks = new TaskService(
        { queue: new SqliteTaskRepository(handle.client), clock, ids },
        new HandlerRegistry(),
      );
      return new InterviewProjectService({
        profiles: new SqliteCandidateProfileRepository(handle.client),
        repository,
        tasks,
        taskPublisher: new SqliteInterviewTaskPublisher({
          client: handle.client,
          tasks,
          projects: repository,
          research: new SqliteInterviewResearchRepository(handle.client),
        }),
        clock,
        ids,
        artifacts: new SqliteArtifactStore(handle.client, root.path),
      });
    };

    const firstService = createService(firstHandle);
    const created = firstService.createDossier({
      profileVersionId: seeded.profileVersionId,
      projectIndex: 0,
      expectedProjectHash: seeded.projectHash,
    });
    const secondHandle = openSqliteDatabase({ dataRoot: root.path });
    handles.push(secondHandle);
    const secondService = createService(secondHandle);
    const dossierId = created.dossier.dossier.id;

    const sameBytes = new TextEncoder().encode('# 架构\n\n初始版本采用模块化单体。');
    const same = await Promise.all([
      firstService.importMaterial({
        dossierId,
        fileName: 'architecture.md',
        bytes: sameBytes,
        signal: new AbortController().signal,
      }),
      secondService.importMaterial({
        dossierId,
        fileName: 'architecture.md',
        bytes: sameBytes,
        signal: new AbortController().signal,
      }),
    ]);
    expect(same[0].material.fileId).toBe(same[1].material.fileId);
    expect(same.map((result) => result.deduplicated).toSorted()).toEqual([false, true]);

    const [first, second] = await Promise.all([
      firstService.importMaterial({
        dossierId,
        fileName: 'architecture.md',
        bytes: new TextEncoder().encode('# 架构\n\n第二版采用事件驱动。'),
        signal: new AbortController().signal,
      }),
      secondService.importMaterial({
        dossierId,
        fileName: 'architecture.md',
        bytes: new TextEncoder().encode('# 架构\n\n第三版采用分层单体。'),
        signal: new AbortController().signal,
      }),
    ]);

    expect(first.material.fileId).toBe(second.material.fileId);
    expect(first.material.fileId).toBe(same[0].material.fileId);
    expect(
      firstHandle.client
        .prepare(
          `SELECT count(*) FROM files
           WHERE kind = 'project_material'
             AND json_extract(properties_json, '$.dossierId') = ?
             AND json_extract(properties_json, '$.fileName') = 'architecture.md'`,
        )
        .pluck()
        .get(dossierId),
    ).toBe(1);
    expect(
      firstHandle.client
        .prepare(
          `SELECT version_no FROM file_entity_mappings
           WHERE file_id = ? ORDER BY version_no`,
        )
        .pluck()
        .all(first.material.fileId),
    ).toEqual([1, 2, 3]);
  });
});
