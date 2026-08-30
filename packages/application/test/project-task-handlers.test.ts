import type { AgentRunner } from '@jobhunter/agent-core';
import { contentHash, parseId, utcInstant } from '@jobhunter/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createProjectAnswerDigestTaskHandler,
  createProjectNotebookTaskHandler,
  createProjectQuestionTaskHandler,
} from '../src/interview/task-handlers.js';
import { questionContextHash } from '../src/interview/context.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';
import type {
  InterviewProjectRepository,
  ProjectAnswerContext,
  ProjectQuestionContext,
} from '../src/ports/interview-projects.js';
import type { TaskHandlerContext } from '../src/tasks/model.js';

const now = utcInstant(1_800_000_000_000);
const taskId = parseId('018f0000-0000-7000-8000-000000000101', 'Task');
const dossierId = parseId('018f0000-0000-7000-8000-000000000102', 'ProjectDossier');
const snapshotId = parseId('018f0000-0000-7000-8000-000000000103', 'ResumeProjectSnapshot');
const sessionId = parseId('018f0000-0000-7000-8000-000000000104', 'DrillSession');
const turnId = parseId('018f0000-0000-7000-8000-000000000105', 'DrillTurn');
const answerId = parseId('018f0000-0000-7000-8000-000000000106', 'DrillAnswerRevision');
const agentRunId = '018f0000-0000-7000-8000-000000000107';

function handlerContext(controller: AbortController): TaskHandlerContext {
  return {
    taskId,
    signal: controller.signal,
    clock: { now: () => now },
    logger: {
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
    },
    services: {},
  };
}

function commonContext(): Pick<ProjectQuestionContext, 'dossier' | 'snapshot' | 'session'> {
  const dossier = {
    id: dossierId,
    snapshotId,
    latestNotebookArtifactId: null,
    notebookSourceHash: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  } as const;
  const snapshot = {
    id: snapshotId,
    sourceProfileId: parseId('018f0000-0000-7000-8000-000000000108', 'CandidateProfile'),
    sourceProfileVersionId: parseId('018f0000-0000-7000-8000-000000000109', 'ProfileVersion'),
    projectIndex: 0,
    project: {
      name: 'JobHunter',
      role: '核心开发者',
      startDate: null,
      endDate: null,
      highlights: ['实现可恢复的面试准备任务'],
      evidence: [],
    },
    contentHash: contentHash('snapshot'),
    createdAt: now,
  } as const;
  const session = {
    id: sessionId,
    dossierId,
    profileKey: 'resume-only',
    profileVersion: 'v1',
    profileDefinitionHash: contentHash('resume-only@v1'),
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
  } as const;
  return { dossier, snapshot, session };
}

describe('project task handler cancellation fence', () => {
  it('lets cancellation win for notebook no-op outputs only', () => {
    const handler = createProjectNotebookTaskHandler({
      repository: {} as InterviewProjectRepository,
      artifacts: {} as ArtifactStore,
      ids: { generate: () => '018f0000-0000-7000-8000-000000000111' },
    });
    const policy = handler.lateCancellationPolicy;
    if (typeof policy !== 'function') throw new Error('Notebook policy must inspect its output.');

    expect(policy({ dossierId, rendered: false, artifactId: null })).toBe('cancel');
    expect(
      policy({
        dossierId,
        rendered: true,
        artifactId: '018f0000-0000-7000-8000-000000000112',
      }),
    ).toBe('complete');
  });

  it('does not commit a question after the task signal is cancelled', async () => {
    const controller = new AbortController();
    const common = commonContext();
    const contextHash = questionContextHash(common.session, 1);
    const source: ProjectQuestionContext = {
      ...common,
      turn: {
        id: turnId,
        sessionId,
        turnNo: 1,
        status: 'question_pending',
        contextHash,
        question: null,
        intent: null,
        primaryDimension: null,
        guidanceSlots: [],
        evidenceRefs: [],
        questionTaskId: taskId,
        questionAgentRunId: null,
        digestTaskId: null,
        digestAgentRunId: null,
        createdAt: now,
        updatedAt: now,
      },
      history: [],
      knowledgeItems: [],
      coverage: [],
      materials: [],
    };
    const completeQuestion = vi.fn(() => true);
    const repository = {
      getQuestionContext: () => source,
      completeQuestion,
    } as unknown as InterviewProjectRepository;
    const runner = {
      run: vi.fn(() => {
        controller.abort();
        return Promise.resolve({
          run: { id: agentRunId },
          output: {
            question: '这个项目最初要解决的核心问题是什么？',
            intent: '核实项目背景。',
            primaryDimension: 'background_goal',
            guidanceSlots: ['业务背景'],
            evidenceRefs: [{ kind: 'resume_project', id: snapshotId }],
          },
          cacheHit: false,
        });
      }),
    } as unknown as AgentRunner;
    const handler = createProjectQuestionTaskHandler({ runner, repository });

    await expect(
      handler.execute(handlerContext(controller), {
        dossierId,
        sessionId,
        turnId,
        expectedContextRevision: 0,
        contextHash,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(completeQuestion).not.toHaveBeenCalled();
  });

  it('does not commit an answer digest after the task signal is cancelled', async () => {
    const controller = new AbortController();
    const common = commonContext();
    const answer = '接口延迟从 300ms 降到 80ms。';
    const source: ProjectAnswerContext = {
      ...common,
      turn: {
        id: turnId,
        sessionId,
        turnNo: 1,
        status: 'digest_pending',
        contextHash: contentHash('digest-context'),
        question: '你如何验证性能优化达到了目标？',
        intent: '核实指标证据。',
        primaryDimension: 'data_metrics',
        guidanceSlots: ['指标'],
        evidenceRefs: [{ kind: 'resume_project', id: snapshotId }],
        questionTaskId: taskId,
        questionAgentRunId: parseId(agentRunId, 'AgentRun'),
        digestTaskId: taskId,
        digestAgentRunId: null,
        createdAt: now,
        updatedAt: now,
      },
      answerRevision: {
        id: answerId,
        turnId,
        revisionNo: 1,
        answer,
        contentHash: contentHash(answer),
        idempotencyKey: 'answer-once',
        createdAt: now,
      },
    };
    const completeAnswerDigest = vi.fn(() => true);
    const repository = {
      getAnswerContext: () => source,
      getDossier: () => ({ coverage: [] }),
      completeAnswerDigest,
    } as unknown as InterviewProjectRepository;
    const runner = {
      run: vi.fn(() => {
        controller.abort();
        return Promise.resolve({
          run: { id: agentRunId },
          output: {
            knowledgeItems: [
              {
                kind: 'metric',
                statement: '接口延迟下降',
                quote: answer,
                start: 0,
                end: answer.length,
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
          cacheHit: false,
        });
      }),
    } as unknown as AgentRunner;
    const handler = createProjectAnswerDigestTaskHandler({
      runner,
      repository,
      ids: {
        generate: () => '018f0000-0000-7000-8000-000000000110',
      },
    });

    await expect(
      handler.execute(handlerContext(controller), {
        dossierId,
        sessionId,
        turnId,
        answerRevisionId: answerId,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(completeAnswerDigest).not.toHaveBeenCalled();
  });
});
