import type {
  DrillCoverageRecord,
  DrillSessionRecord,
  DrillTurnRecord,
  ProjectDossierRecord,
  ResumeProjectSnapshotRecord,
} from '@jobhunter/application';
import {
  contentHash,
  drillCoverageDimensions,
  parseId,
  utcInstant,
  type CandidateProject,
} from '@jobhunter/domain';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteInterviewProjectRepository,
  type SqliteDatabaseHandle,
} from '../src/index.js';

const ids = {
  profile: '018f0000-0000-7000-8000-000000000201',
  profileVersion: '018f0000-0000-7000-8000-000000000202',
  snapshot: '018f0000-0000-7000-8000-000000000203',
  dossier: '018f0000-0000-7000-8000-000000000204',
  session: '018f0000-0000-7000-8000-000000000205',
  turn: '018f0000-0000-7000-8000-000000000206',
  questionTask: '018f0000-0000-7000-8000-000000000207',
  questionRun: '018f0000-0000-7000-8000-000000000208',
  answer: '018f0000-0000-7000-8000-000000000209',
  digestTask: '018f0000-0000-7000-8000-000000000210',
  digestRun: '018f0000-0000-7000-8000-000000000211',
  knowledge: '018f0000-0000-7000-8000-000000000212',
  artifact: '018f0000-0000-7000-8000-000000000213',
  materialFile: '018f0000-0000-7000-8000-000000000214',
  materialEntityV1: '018f0000-0000-7000-8000-000000000215',
  materialEntityV2: '018f0000-0000-7000-8000-000000000216',
  materialChunkV1: '018f0000-0000-7000-8000-000000000217',
  materialChunkV2: '018f0000-0000-7000-8000-000000000218',
  deepSession: '018f0000-0000-7000-8000-000000000219',
  deepTurn: '018f0000-0000-7000-8000-000000000220',
  otherQuestionTask: '018f0000-0000-7000-8000-000000000221',
  otherDigestTask: '018f0000-0000-7000-8000-000000000222',
} as const;

const roots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function fixture(): Promise<{
  handle: SqliteDatabaseHandle;
  repository: SqliteInterviewProjectRepository;
  project: CandidateProject;
}> {
  const root = await createTemporaryDataRoot('jobhunter-interview-');
  roots.push(root);
  const handle = openSqliteDatabase({ dataRoot: root.path });
  handles.push(handle);
  const project: CandidateProject = {
    name: 'JobHunter',
    role: '核心开发者',
    startDate: '2026-01',
    endDate: null,
    highlights: ['实现可追溯的职位同步与匹配'],
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
    .run(ids.profile, '测试用户');
  handle.client
    .prepare(
      `INSERT INTO profile_versions
       (id, profile_id, version_no, extracted_json, effective_json, locked_paths_json,
        content_hash, is_current, created_at) VALUES (?, ?, 1, ?, ?, '[]', ?, 1, 1)`,
    )
    .run(
      ids.profileVersion,
      ids.profile,
      JSON.stringify(profile),
      JSON.stringify(profile),
      contentHash(profile),
    );
  return { handle, repository: new SqliteInterviewProjectRepository(handle.client), project };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function insertTask(handle: SqliteDatabaseHandle, id: string): void {
  handle.client
    .prepare(
      `INSERT INTO tasks
       (id, task_type, payload_json, status, idempotency_key, max_attempts, available_at, created_at)
       VALUES (?, 'fixture', '{}', 'pending', ?, 1, 1, 1)`,
    )
    .run(id, id);
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function insertAgentRun(handle: SqliteDatabaseHandle, id: string): void {
  handle.client
    .prepare(
      `INSERT INTO agent_runs
       (id, agent_key, agent_version, prompt_version, model_config_hash, input_hash, cache_key,
        status, output_json, started_at, finished_at)
       VALUES (?, 'fixture', 'v1', 'v1', ?, ?, ?, 'succeeded', '{}', 1, 2)`,
    )
    .run(id, 'a'.repeat(64), 'b'.repeat(64), id);
}

describe('SQLite interview project repository', () => {
  it('persists an idempotent dossier and a guarded question-answer-digest lifecycle', async () => {
    const { handle, repository, project } = await fixture();
    const now = utcInstant(1_800_000_000_000);
    const snapshot: ResumeProjectSnapshotRecord = {
      id: parseId(ids.snapshot, 'ResumeProjectSnapshot'),
      sourceProfileId: parseId(ids.profile, 'CandidateProfile'),
      sourceProfileVersionId: parseId(ids.profileVersion, 'ProfileVersion'),
      projectIndex: 0,
      project,
      contentHash: contentHash(project),
      createdAt: now,
    };
    const dossier: ProjectDossierRecord = {
      id: parseId(ids.dossier, 'ProjectDossier'),
      snapshotId: snapshot.id,
      latestNotebookArtifactId: null,
      notebookSourceHash: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    expect(repository.createDossier({ dossier, snapshot }).deduplicated).toBe(false);
    expect(
      repository.createDossier({
        dossier: {
          ...dossier,
          id: parseId('018f0000-0000-7000-8000-000000000299', 'ProjectDossier'),
        },
        snapshot: {
          ...snapshot,
          id: parseId('018f0000-0000-7000-8000-000000000298', 'ResumeProjectSnapshot'),
        },
      }),
    ).toMatchObject({ dossier: { id: dossier.id }, deduplicated: true });

    const session: DrillSessionRecord = {
      id: parseId(ids.session, 'DrillSession'),
      dossierId: dossier.id,
      profileKey: 'resume-only',
      profileVersion: 'v1',
      profileDefinitionHash: contentHash({ profile: 'v1' }),
      capabilitySummary: {
        evidenceKinds: ['resume_project', 'user_answer', 'derived_claim'],
        tools: [],
      },
      materialBindings: [],
      status: 'active',
      contextRevision: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const coverage: DrillCoverageRecord[] = drillCoverageDimensions.map((dimension) => ({
      sessionId: session.id,
      dimension,
      status: 'unasked',
      evidenceItemIds: [],
      updatedAt: now,
    }));
    repository.createSession({ session, coverage });

    const contextHash = contentHash({ session: session.id, revision: 0 });
    const turn: DrillTurnRecord = {
      id: parseId(ids.turn, 'DrillTurn'),
      sessionId: session.id,
      turnNo: 1,
      status: 'question_pending',
      contextHash,
      question: null,
      intent: null,
      primaryDimension: null,
      guidanceSlots: [],
      evidenceRefs: [],
      questionTaskId: null,
      questionAgentRunId: null,
      digestTaskId: null,
      digestAgentRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    repository.createQuestionTurn({ turn, expectedSessionRevision: 0 });
    insertTask(handle, ids.questionTask);
    repository.attachQuestionTask({
      turnId: turn.id,
      taskId: parseId(ids.questionTask, 'Task'),
      now,
    });
    insertAgentRun(handle, ids.questionRun);
    const questionCompletion = {
      turnId: turn.id,
      expectedContextHash: contextHash,
      expectedSessionRevision: 0,
      question: '这个项目的成功标准是什么，你用哪些数据验证？',
      intent: '确认目标与指标。',
      primaryDimension: 'data_metrics' as const,
      guidanceSlots: ['目标', '指标', '结果'],
      evidenceRefs: [{ kind: 'resume_project' as const, id: snapshot.id }],
      agentRunId: parseId(ids.questionRun, 'AgentRun'),
      now,
    };
    expect(
      repository.completeQuestion({
        ...questionCompletion,
        expectedTaskId: parseId(ids.questionTask, 'Task'),
      }),
    ).toBe(false);
    insertTask(handle, ids.otherQuestionTask);
    handle.client
      .prepare("UPDATE tasks SET status = 'running' WHERE id IN (?, ?)")
      .run(ids.questionTask, ids.otherQuestionTask);
    expect(
      repository.completeQuestion({
        ...questionCompletion,
        expectedTaskId: parseId(ids.otherQuestionTask, 'Task'),
      }),
    ).toBe(false);
    handle.client
      .prepare('UPDATE tasks SET cancel_requested_at = 2 WHERE id = ?')
      .run(ids.questionTask);
    expect(
      repository.completeQuestion({
        ...questionCompletion,
        expectedTaskId: parseId(ids.questionTask, 'Task'),
      }),
    ).toBe(false);
    handle.client
      .prepare('UPDATE tasks SET cancel_requested_at = NULL WHERE id = ?')
      .run(ids.questionTask);
    expect(
      repository.completeQuestion({
        ...questionCompletion,
        expectedTaskId: parseId(ids.questionTask, 'Task'),
      }),
    ).toBe(true);

    const answerText = '接口延迟从 300ms 降到 80ms。';
    const answer = {
      id: parseId(ids.answer, 'DrillAnswerRevision'),
      turnId: turn.id,
      revisionNo: 1,
      answer: answerText,
      contentHash: contentHash(answerText),
      idempotencyKey: 'answer-once',
      createdAt: now,
    } as const;
    expect(
      repository.appendAnswer({
        sessionId: session.id,
        turnId: turn.id,
        answer,
        expectedSessionRevision: 0,
        now,
      }).deduplicated,
    ).toBe(false);
    expect(
      repository.appendAnswer({
        sessionId: session.id,
        turnId: turn.id,
        answer: {
          ...answer,
          id: parseId('018f0000-0000-7000-8000-000000000297', 'DrillAnswerRevision'),
        },
        expectedSessionRevision: 0,
        now,
      }),
    ).toMatchObject({ answer: { id: answer.id }, deduplicated: true });

    insertTask(handle, ids.digestTask);
    repository.attachDigestTask({
      turnId: turn.id,
      taskId: parseId(ids.digestTask, 'Task'),
      now,
    });
    insertAgentRun(handle, ids.digestRun);
    const knowledgeId = parseId(ids.knowledge, 'ProjectKnowledgeItem');
    const digestCompletion = {
      turnId: turn.id,
      answerRevisionId: answer.id,
      expectedSessionRevision: 1,
      agentRunId: parseId(ids.digestRun, 'AgentRun'),
      knowledgeItems: [
        {
          id: knowledgeId,
          dossierId: dossier.id,
          sourceAnswerRevisionId: answer.id,
          kind: 'metric' as const,
          statement: '接口延迟下降',
          quote: answerText.slice(0, -1),
          start: 0,
          end: answerText.length - 1,
          status: 'active' as const,
          createdAt: now,
        },
      ],
      coverage: [
        {
          sessionId: session.id,
          dimension: 'data_metrics' as const,
          status: 'evidence_sufficient' as const,
          evidenceItemIds: [knowledgeId],
          updatedAt: now,
        },
      ],
      now,
    };
    expect(
      repository.completeAnswerDigest({
        ...digestCompletion,
        expectedTaskId: parseId(ids.digestTask, 'Task'),
      }),
    ).toBe(false);
    insertTask(handle, ids.otherDigestTask);
    handle.client
      .prepare("UPDATE tasks SET status = 'running' WHERE id IN (?, ?)")
      .run(ids.digestTask, ids.otherDigestTask);
    expect(
      repository.completeAnswerDigest({
        ...digestCompletion,
        expectedTaskId: parseId(ids.otherDigestTask, 'Task'),
      }),
    ).toBe(false);
    handle.client
      .prepare('UPDATE tasks SET cancel_requested_at = 2 WHERE id = ?')
      .run(ids.digestTask);
    expect(
      repository.completeAnswerDigest({
        ...digestCompletion,
        expectedTaskId: parseId(ids.digestTask, 'Task'),
      }),
    ).toBe(false);
    handle.client
      .prepare('UPDATE tasks SET cancel_requested_at = NULL WHERE id = ?')
      .run(ids.digestTask);
    expect(
      repository.completeAnswerDigest({
        ...digestCompletion,
        expectedTaskId: parseId(ids.digestTask, 'Task'),
      }),
    ).toBe(true);

    const detail = repository.getDossier(dossier.id);
    expect(detail).toMatchObject({
      sourceAvailable: true,
      sessions: 1,
      turns: [{ status: 'ready' }],
      answers: [{ answer: answerText }],
      knowledgeItems: [{ kind: 'metric', status: 'active' }],
    });
    expect(detail?.coverage.find((item) => item.dimension === 'data_metrics')).toMatchObject({
      status: 'evidence_sufficient',
      evidenceItemIds: [knowledgeId],
    });

    handle.client.prepare('DELETE FROM candidate_profiles WHERE id = ?').run(ids.profile);
    expect(repository.getDossier(dossier.id)?.sourceAvailable).toBe(false);
  });

  it('registers material versions and resolves question context from frozen bindings', async () => {
    const { handle, repository, project } = await fixture();
    const now = utcInstant(1_800_000_000_000);
    const later = utcInstant(1_800_000_000_001);
    const snapshot: ResumeProjectSnapshotRecord = {
      id: parseId(ids.snapshot, 'ResumeProjectSnapshot'),
      sourceProfileId: parseId(ids.profile, 'CandidateProfile'),
      sourceProfileVersionId: parseId(ids.profileVersion, 'ProfileVersion'),
      projectIndex: 0,
      project,
      contentHash: contentHash(project),
      createdAt: now,
    };
    const dossier: ProjectDossierRecord = {
      id: parseId(ids.dossier, 'ProjectDossier'),
      snapshotId: snapshot.id,
      latestNotebookArtifactId: null,
      notebookSourceHash: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    repository.createDossier({ dossier, snapshot });

    const firstText = '系统按事件驱动方式拆分写入与消费流程。';
    handle.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'project_material', 'architecture.md', 'stored', 0, '{}', ?, ?)`,
      )
      .run(ids.materialFile, now, now);
    handle.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES (?, 'artifacts/material/v1', 'text/markdown; charset=utf-8', ?, ?, ?, NULL)`,
      )
      .run(ids.materialEntityV1, 'a'.repeat(64), firstText.length, now);
    handle.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, metadata_json, created_at)
         VALUES (?, ?, 1, '{}', ?)`,
      )
      .run(ids.materialFile, ids.materialEntityV1, now);
    const first = repository.registerMaterial({
      dossierId: dossier.id,
      fileId: ids.materialFile,
      entityId: ids.materialEntityV1,
      fileName: 'architecture.md',
      normalizedText: firstText,
      parserVersion: 'project-material-markdown@v1',
      chunks: [
        {
          id: parseId(ids.materialChunkV1, 'ProjectMaterialChunk'),
          heading: '架构设计',
          start: 0,
          end: firstText.length,
          contentHash: contentHash(firstText),
        },
      ],
      now,
    });
    expect(first).toMatchObject({ deduplicated: false, material: { versionNo: 1 } });
    expect(
      repository.registerMaterial({
        dossierId: dossier.id,
        fileId: ids.materialFile,
        entityId: ids.materialEntityV1,
        fileName: 'architecture.md',
        normalizedText: firstText,
        parserVersion: 'project-material-markdown@v1',
        chunks: first.material.chunks,
        now,
      }),
    ).toMatchObject({ deduplicated: true, material: { versionNo: 1 } });
    const frozenBinding = repository.resolveMaterialBindings(dossier.id, [ids.materialFile])[0];
    if (!frozenBinding) throw new Error('First project material binding was not resolved.');

    const secondText = '系统后来改为模块化单体，并通过事务内事件保持一致性。';
    handle.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES (?, 'artifacts/material/v2', 'text/markdown; charset=utf-8', ?, ?, ?, NULL)`,
      )
      .run(ids.materialEntityV2, 'b'.repeat(64), secondText.length, later);
    handle.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, metadata_json, created_at)
         VALUES (?, ?, 2, '{}', ?)`,
      )
      .run(ids.materialFile, ids.materialEntityV2, later);
    repository.registerMaterial({
      dossierId: dossier.id,
      fileId: ids.materialFile,
      entityId: ids.materialEntityV2,
      fileName: 'architecture.md',
      normalizedText: secondText,
      parserVersion: 'project-material-markdown@v1',
      chunks: [
        {
          id: parseId(ids.materialChunkV2, 'ProjectMaterialChunk'),
          heading: '架构演进',
          start: 0,
          end: secondText.length,
          contentHash: contentHash(secondText),
        },
      ],
      now: later,
    });

    expect(repository.findMaterialByName(dossier.id, 'architecture.md')).toMatchObject({
      versionNo: 2,
      entityId: ids.materialEntityV2,
    });
    expect(repository.getDossier(dossier.id)?.materials).toMatchObject([
      { versionNo: 1, entityId: ids.materialEntityV1 },
      { versionNo: 2, entityId: ids.materialEntityV2 },
    ]);
    expect(repository.resolveMaterialBindings(dossier.id, [ids.materialFile])).toMatchObject([
      { versionNo: 2, entityId: ids.materialEntityV2 },
    ]);

    const session: DrillSessionRecord = {
      id: parseId(ids.deepSession, 'DrillSession'),
      dossierId: dossier.id,
      profileKey: 'docs-grounded',
      profileVersion: 'v1',
      profileDefinitionHash: contentHash({ profile: 'docs-grounded@v1' }),
      capabilitySummary: {
        evidenceKinds: ['resume_project', 'user_answer', 'derived_claim', 'project_material'],
        tools: ['selected_markdown_heading_search', 'selected_markdown_chunk_read'],
      },
      materialBindings: [frozenBinding],
      status: 'active',
      contextRevision: 0,
      createdAt: later,
      updatedAt: later,
      completedAt: null,
    };
    repository.createSession({
      session,
      coverage: drillCoverageDimensions.map((dimension) => ({
        sessionId: session.id,
        dimension,
        status: 'unasked',
        evidenceItemIds: [],
        updatedAt: later,
      })),
    });
    expect(repository.getSession(session.id)).toMatchObject({
      profileKey: 'docs-grounded',
      materialBindings: [{ versionNo: 1, entityId: ids.materialEntityV1 }],
    });

    const turn: DrillTurnRecord = {
      id: parseId(ids.deepTurn, 'DrillTurn'),
      sessionId: session.id,
      turnNo: 1,
      status: 'question_pending',
      contextHash: contentHash({ session: session.id, materialBindings: session.materialBindings }),
      question: null,
      intent: null,
      primaryDimension: null,
      guidanceSlots: [],
      evidenceRefs: [],
      questionTaskId: null,
      questionAgentRunId: null,
      digestTaskId: null,
      digestAgentRunId: null,
      createdAt: later,
      updatedAt: later,
    };
    repository.createQuestionTurn({ turn, expectedSessionRevision: 0 });
    expect(repository.getQuestionContext(turn.id)?.materials).toMatchObject([
      {
        versionNo: 1,
        entityId: ids.materialEntityV1,
        chunks: [{ id: ids.materialChunkV1, text: firstText }],
      },
    ]);

    handle.client
      .prepare(
        `UPDATE file_entity_mappings SET normalized_text = '被篡改'
         WHERE file_id = ? AND version_no = 1`,
      )
      .run(ids.materialFile);
    expect(() => repository.getQuestionContext(turn.id)).toThrow(
      /material chunk range|material chunk hash/iu,
    );
  });

  it('compares deletion impact and removes only dossier-owned rows', async () => {
    const { handle, repository, project } = await fixture();
    const now = utcInstant(1_800_000_000_000);
    const snapshot: ResumeProjectSnapshotRecord = {
      id: parseId(ids.snapshot, 'ResumeProjectSnapshot'),
      sourceProfileId: parseId(ids.profile, 'CandidateProfile'),
      sourceProfileVersionId: parseId(ids.profileVersion, 'ProfileVersion'),
      projectIndex: 0,
      project,
      contentHash: contentHash(project),
      createdAt: now,
    };
    const dossier: ProjectDossierRecord = {
      id: parseId(ids.dossier, 'ProjectDossier'),
      snapshotId: snapshot.id,
      latestNotebookArtifactId: null,
      notebookSourceHash: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    repository.createDossier({ dossier, snapshot });
    handle.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES (?, 'artifacts/fixture/notebook', 'text/markdown', ?, 8, ?, NULL)`,
      )
      .run(ids.artifact, 'f'.repeat(64), now);
    handle.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'project_notebook', 'notebook.md', 'stored', 0, '{}', ?, ?)`,
      )
      .run(ids.artifact, now, now);
    handle.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, metadata_json, created_at)
         VALUES (?, ?, 1, '{}', ?)`,
      )
      .run(ids.artifact, ids.artifact, now);
    handle.client
      .prepare('UPDATE project_dossiers SET notebook_file_id = ? WHERE id = ?')
      .run(ids.artifact, dossier.id);
    const impact = repository.previewDeletion(dossier.id);
    if (!impact) throw new Error('Deletion impact fixture was not created.');
    expect(impact).toMatchObject({
      notebookArtifactId: ids.artifact,
      notebookRelativePath: 'artifacts/fixture/notebook',
      notebookShared: false,
    });
    expect(
      repository.deleteDossier({
        expected: { ...impact, dossierRevision: 1 },
        quarantinedArtifacts: [],
        deletedAt: now,
      }),
    ).toBe(false);
    expect(
      repository.deleteDossier({
        expected: impact,
        quarantinedArtifacts: [
          {
            artifactId: ids.artifact,
            originalRelativePath: 'artifacts/fixture/notebook',
            quarantinedRelativePath: `deleted-artifacts/${ids.artifact}/notebook`,
            fileExisted: true,
          },
        ],
        deletedAt: now,
      }),
    ).toBe(true);
    expect(repository.getDossier(dossier.id)).toBeNull();
    expect(handle.client.prepare('SELECT count(*) FROM candidate_profiles').pluck().get()).toBe(1);
    expect(
      handle.client
        .prepare('SELECT relative_path, deleted_at FROM entities WHERE id = ?')
        .get(ids.artifact),
    ).toEqual({
      relative_path: `deleted-artifacts/${ids.artifact}/notebook`,
      deleted_at: now,
    });
    repository.removePurgedArtifact(ids.artifact);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(0);
  });

  it('does not quarantine a notebook artifact shared with another business owner', async () => {
    const { handle, repository, project } = await fixture();
    const now = utcInstant(1_800_000_000_000);
    const snapshot: ResumeProjectSnapshotRecord = {
      id: parseId(ids.snapshot, 'ResumeProjectSnapshot'),
      sourceProfileId: parseId(ids.profile, 'CandidateProfile'),
      sourceProfileVersionId: parseId(ids.profileVersion, 'ProfileVersion'),
      projectIndex: 0,
      project,
      contentHash: contentHash(project),
      createdAt: now,
    };
    repository.createDossier({
      snapshot,
      dossier: {
        id: parseId(ids.dossier, 'ProjectDossier'),
        snapshotId: snapshot.id,
        latestNotebookArtifactId: null,
        notebookSourceHash: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    handle.client
      .prepare(
        `INSERT INTO entities
         (id, relative_path, media_type, sha256, byte_size, created_at, deleted_at)
         VALUES (?, 'artifacts/shared/notebook', 'text/markdown', ?, 8, ?, NULL)`,
      )
      .run(ids.artifact, 'f'.repeat(64), now);
    handle.client
      .prepare(
        `INSERT INTO files
         (id, kind, name, state, revision, properties_json, created_at, updated_at)
         VALUES (?, 'project_notebook', 'notebook.md', 'stored', 0, '{}', ?, ?),
                ('resume-document', 'resume', 'resume.md', 'parsed', 0, '{}', ?, ?)`,
      )
      .run(ids.artifact, now, now, now, now);
    handle.client
      .prepare(
        `INSERT INTO file_entity_mappings
         (file_id, entity_id, version_no, metadata_json, created_at)
         VALUES (?, ?, 1, '{}', ?), ('resume-document', ?, 1, '{}', ?)`,
      )
      .run(ids.artifact, ids.artifact, now, ids.artifact, now);
    handle.client
      .prepare('UPDATE project_dossiers SET notebook_file_id = ? WHERE id = ?')
      .run(ids.artifact, ids.dossier);

    const impact = repository.previewDeletion(parseId(ids.dossier, 'ProjectDossier'));
    if (!impact) throw new Error('Shared deletion impact fixture was not created.');
    expect(impact.notebookShared).toBe(true);
    expect(
      repository.deleteDossier({ expected: impact, quarantinedArtifacts: [], deletedAt: now }),
    ).toBe(true);
    expect(handle.client.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(1);
    expect(
      handle.client.prepare("SELECT count(*) FROM files WHERE kind = 'resume'").pluck().get(),
    ).toBe(1);
  });
});
