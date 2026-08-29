import {
  createProjectAnswerDigestTaskHandler,
  createProjectNotebookTaskHandler,
  createProjectQuestionTaskHandler,
  HandlerRegistry,
  InterviewProjectService,
  TaskService,
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
  it('runs one Web-enqueued question, answer digest and Markdown projection', async () => {
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
    registry.register(createProjectQuestionTaskHandler({ runner, repository }));
    registry.register(createProjectAnswerDigestTaskHandler({ runner, repository, ids }));
    registry.register(createProjectNotebookTaskHandler({ repository, artifacts, ids }));
    const tasks = new TaskService({ queue, clock, ids }, registry);
    const service = new InterviewProjectService({
      profiles,
      repository,
      tasks,
      clock,
      ids,
      artifacts,
      notebooks: new SqliteProjectNotebookReader(handle.client, root.path),
    });
    const created = service.createDossier({
      profileVersionId: seeded.profileVersionId,
      projectIndex: 0,
      expectedProjectHash: seeded.projectHash,
    });
    const started = service.startSession(created.dossier.dossier.id);

    const initialNotebook = tasks.list({ taskType: 'interview.project-notebook.render' })[0];
    if (!initialNotebook) throw new Error('Initial notebook task was not enqueued.');
    await registry.execute(
      initialNotebook.taskType,
      {
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      initialNotebook.payload,
    );
    handle.client
      .prepare("UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE id = ?")
      .run(clock.now(), initialNotebook.id);

    const questionTask = service.requestQuestion(started.sessionId).task;
    await registry.execute(
      questionTask.taskType,
      {
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      questionTask.payload,
    );
    handle.client
      .prepare("UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE id = ?")
      .run(clock.now(), questionTask.id);
    const questioned = service.getDossier(created.dossier.dossier.id);
    const turn = questioned.turns[0];
    if (!turn) throw new Error('Question turn was not created.');
    expect(turn).toMatchObject({ status: 'awaiting_answer', primaryDimension: 'background_goal' });

    const answer = '接口延迟从 300ms 降到 80ms';
    const digestTask = service.submitAnswer({
      sessionId: started.sessionId,
      turnId: turn.id,
      answer,
      idempotencyToken: 'answer-token-1',
    }).task;
    expect(
      service.submitAnswer({
        sessionId: started.sessionId,
        turnId: turn.id,
        answer,
        idempotencyToken: 'answer-token-1',
      }),
    ).toMatchObject({ task: { id: digestTask.id }, deduplicated: true });
    await registry.execute(
      digestTask.taskType,
      {
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        services: {},
      },
      digestTask.payload,
    );
    handle.client
      .prepare("UPDATE tasks SET status = 'succeeded', finished_at = ? WHERE id = ?")
      .run(clock.now(), digestTask.id);

    const revisedAnswer = '接口延迟从 300ms 降到 80ms，并连续观察七天。';
    const revisionTask = service.submitAnswer({
      sessionId: started.sessionId,
      turnId: turn.id,
      answer: revisedAnswer,
      idempotencyToken: 'answer-token-2',
    }).task;
    await registry.execute(
      revisionTask.taskType,
      {
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
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
    const artifact = handle.client
      .prepare('SELECT relative_path FROM file_artifacts WHERE id = ?')
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
  });
});
