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
} as const;

const roots: Awaited<ReturnType<typeof createTemporaryDataRoot>>[] = [];
const handles: SqliteDatabaseHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(roots.splice(0).map((root) => root.cleanup()));
});

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

function insertTask(handle: SqliteDatabaseHandle, id: string): void {
  handle.client
    .prepare(
      `INSERT INTO tasks
       (id, task_type, payload_json, status, idempotency_key, max_attempts, available_at, created_at)
       VALUES (?, 'fixture', '{}', 'pending', ?, 1, 1, 1)`,
    )
    .run(id, id);
}

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
    expect(
      repository.completeQuestion({
        turnId: turn.id,
        expectedContextHash: contextHash,
        expectedSessionRevision: 0,
        question: '这个项目的成功标准是什么，你用哪些数据验证？',
        intent: '确认目标与指标。',
        primaryDimension: 'data_metrics',
        guidanceSlots: ['目标', '指标', '结果'],
        evidenceRefs: [{ kind: 'resume_project', id: snapshot.id }],
        agentRunId: parseId(ids.questionRun, 'AgentRun'),
        now,
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
    expect(
      repository.completeAnswerDigest({
        turnId: turn.id,
        answerRevisionId: answer.id,
        expectedSessionRevision: 1,
        agentRunId: parseId(ids.digestRun, 'AgentRun'),
        knowledgeItems: [
          {
            id: knowledgeId,
            dossierId: dossier.id,
            sourceAnswerRevisionId: answer.id,
            kind: 'metric',
            statement: '接口延迟下降',
            quote: answerText.slice(0, -1),
            start: 0,
            end: answerText.length - 1,
            status: 'active',
            createdAt: now,
          },
        ],
        coverage: [
          {
            sessionId: session.id,
            dimension: 'data_metrics',
            status: 'evidence_sufficient',
            evidenceItemIds: [knowledgeId],
            updatedAt: now,
          },
        ],
        now,
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
        `INSERT INTO file_artifacts
         (id, kind, relative_path, media_type, sha256, byte_size, created_at)
         VALUES (?, 'export', 'artifacts/fixture/notebook', 'text/markdown', ?, 8, ?)`,
      )
      .run(ids.artifact, 'f'.repeat(64), now);
    handle.client
      .prepare('UPDATE project_dossiers SET latest_notebook_artifact_id = ? WHERE id = ?')
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
        quarantinedArtifact: null,
        deletedAt: now,
      }),
    ).toBe(false);
    expect(
      repository.deleteDossier({
        expected: impact,
        quarantinedArtifact: {
          artifactId: ids.artifact,
          originalRelativePath: 'artifacts/fixture/notebook',
          quarantinedRelativePath: `deleted-artifacts/${ids.artifact}/notebook`,
          fileExisted: true,
        },
        deletedAt: now,
      }),
    ).toBe(true);
    expect(repository.getDossier(dossier.id)).toBeNull();
    expect(handle.client.prepare('SELECT count(*) FROM candidate_profiles').pluck().get()).toBe(1);
    expect(
      handle.client
        .prepare('SELECT relative_path, deleted_at FROM file_artifacts WHERE id = ?')
        .get(ids.artifact),
    ).toEqual({
      relative_path: `deleted-artifacts/${ids.artifact}/notebook`,
      deleted_at: now,
    });
    repository.removePurgedNotebookArtifact(ids.artifact);
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(0);
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
        `INSERT INTO file_artifacts
         (id, kind, relative_path, media_type, sha256, byte_size, created_at)
         VALUES (?, 'export', 'artifacts/shared/notebook', 'text/markdown', ?, 8, ?)`,
      )
      .run(ids.artifact, 'f'.repeat(64), now);
    handle.client
      .prepare(
        `INSERT INTO resume_documents
         (id, artifact_id, content_hash, media_type, parse_status, created_at)
         VALUES ('resume-document', ?, ?, 'text/markdown', 'parsed', ?)`,
      )
      .run(ids.artifact, 'e'.repeat(64), now);
    handle.client
      .prepare('UPDATE project_dossiers SET latest_notebook_artifact_id = ? WHERE id = ?')
      .run(ids.artifact, ids.dossier);

    const impact = repository.previewDeletion(parseId(ids.dossier, 'ProjectDossier'));
    if (!impact) throw new Error('Shared deletion impact fixture was not created.');
    expect(impact.notebookShared).toBe(true);
    expect(
      repository.deleteDossier({ expected: impact, quarantinedArtifact: null, deletedAt: now }),
    ).toBe(true);
    expect(handle.client.prepare('SELECT count(*) FROM file_artifacts').pluck().get()).toBe(1);
    expect(handle.client.prepare('SELECT count(*) FROM resume_documents').pluck().get()).toBe(1);
  });
});
