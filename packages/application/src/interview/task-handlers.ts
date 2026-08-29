import { AgentRuntimeError, type AgentRunner } from '@jobhunter/agent-core';
import {
  assertAnswerDigest,
  assertGeneratedProjectQuestion,
  contentHash,
  DomainError,
  parseId,
  type IdGenerator,
} from '@jobhunter/domain';
import { z } from 'zod';
import { mapAgentRuntimeError } from '../agents/error-mapping.js';
import type { ArtifactStore } from '../ports/artifact-store.js';
import type { InterviewProjectRepository } from '../ports/interview-projects.js';
import type { TaskHandler } from '../tasks/model.js';
import { TaskExecutionError } from '../tasks/retry-policy.js';
import { projectAnswerDigestAgentDefinition, projectQuestionAgentDefinition } from './agents.js';
import { buildQuestionAgentInput, questionContextHash } from './context.js';
import { renderProjectNotebook } from './notebook.js';

export const projectQuestionTaskPayloadSchema = z
  .object({
    dossierId: z.uuid(),
    sessionId: z.uuid(),
    turnId: z.uuid(),
    expectedContextRevision: z.number().int().nonnegative(),
    contextHash: z.string().length(64),
  })
  .strict();

export const projectQuestionTaskOutputSchema = z
  .object({ turnId: z.uuid(), agentRunId: z.uuid(), cacheHit: z.boolean() })
  .strict();

export const projectAnswerDigestTaskPayloadSchema = z
  .object({
    dossierId: z.uuid(),
    sessionId: z.uuid(),
    turnId: z.uuid(),
    answerRevisionId: z.uuid(),
  })
  .strict();

export const projectAnswerDigestTaskOutputSchema = z
  .object({
    turnId: z.uuid(),
    answerRevisionId: z.uuid(),
    agentRunId: z.uuid(),
    cacheHit: z.boolean(),
    knowledgeItems: z.number().int().nonnegative(),
  })
  .strict();

export const projectNotebookTaskPayloadSchema = z
  .object({ dossierId: z.uuid(), sourceRevision: z.number().int().nonnegative() })
  .strict();

export const projectNotebookTaskOutputSchema = z
  .object({ dossierId: z.uuid(), rendered: z.boolean(), artifactId: z.uuid().nullable() })
  .strict();

type CommitCallback = (dossierId: string) => void;

export function createProjectQuestionTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly repository: InterviewProjectRepository;
        readonly onCommitted?: CommitCallback;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof projectQuestionTaskPayloadSchema>,
  z.infer<typeof projectQuestionTaskOutputSchema>
> {
  return {
    taskType: 'interview.project-question',
    payloadSchema: projectQuestionTaskPayloadSchema,
    outputSchema: projectQuestionTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `interview-session:${payload.sessionId}`,
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError(
          'invalid_config',
          'Interview question model is not configured.',
        );
      }
      const turnId = parseId(payload.turnId, 'DrillTurn');
      const source = input.repository.getQuestionContext(turnId);
      if (
        source?.dossier.id !== payload.dossierId ||
        source.session.id !== payload.sessionId ||
        source.session.contextRevision !== payload.expectedContextRevision ||
        source.turn.status !== 'question_pending' ||
        source.turn.contextHash !== payload.contextHash ||
        questionContextHash(source.session, source.turn.turnNo) !== payload.contextHash
      ) {
        throw new TaskExecutionError('cancelled', 'Interview question context is stale.');
      }
      const agentInput = buildQuestionAgentInput(source);
      try {
        const result = await input.runner.run({
          definition: projectQuestionAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const question = assertGeneratedProjectQuestion(
          result.output,
          agentInput.allowedEvidenceRefs,
        );
        const committed = input.repository.completeQuestion({
          turnId,
          expectedContextHash: source.turn.contextHash,
          expectedSessionRevision: source.session.contextRevision,
          ...question,
          agentRunId: parseId(result.run.id, 'AgentRun'),
          now: context.clock.now(),
        });
        if (!committed) {
          throw new TaskExecutionError('cancelled', 'Interview question result became stale.');
        }
        input.onCommitted?.(payload.dossierId);
        return { turnId, agentRunId: result.run.id, cacheHit: result.cacheHit };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Interview question Agent');
        }
        if (error instanceof DomainError || error instanceof z.ZodError) {
          throw new TaskExecutionError(
            'validation_failed',
            'Interview question output was rejected.',
            {
              cause: error,
            },
          );
        }
        throw error;
      }
    },
  };
}

export function createProjectAnswerDigestTaskHandler(
  input:
    | {
        readonly runner: AgentRunner;
        readonly repository: InterviewProjectRepository;
        readonly ids: IdGenerator;
        readonly onCommitted?: CommitCallback;
      }
    | { readonly unavailable: true },
): TaskHandler<
  z.infer<typeof projectAnswerDigestTaskPayloadSchema>,
  z.infer<typeof projectAnswerDigestTaskOutputSchema>
> {
  return {
    taskType: 'interview.project-answer-digest',
    payloadSchema: projectAnswerDigestTaskPayloadSchema,
    outputSchema: projectAnswerDigestTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 120_000,
    concurrencyKey: (payload) => `interview-session:${payload.sessionId}`,
    async execute(context, payload) {
      if ('unavailable' in input) {
        throw new TaskExecutionError('invalid_config', 'Interview answer model is not configured.');
      }
      const turnId = parseId(payload.turnId, 'DrillTurn');
      const answerRevisionId = parseId(payload.answerRevisionId, 'DrillAnswerRevision');
      const source = input.repository.getAnswerContext(turnId, answerRevisionId);
      if (
        source?.dossier.id !== payload.dossierId ||
        source.session.id !== payload.sessionId ||
        source.turn.status !== 'digest_pending' ||
        source.turn.question === null
      ) {
        throw new TaskExecutionError('cancelled', 'Interview answer context is stale.');
      }
      const agentInput = {
        project: {
          name: source.snapshot.project.name,
          role: source.snapshot.project.role,
          startDate: source.snapshot.project.startDate,
          endDate: source.snapshot.project.endDate,
          highlights: source.snapshot.project.highlights,
        },
        question: source.turn.question,
        answer: source.answerRevision.answer,
        coverage:
          input.repository
            .getDossier(source.dossier.id)
            ?.coverage.filter((item) => item.sessionId === source.session.id)
            .map((item) => ({ dimension: item.dimension, status: item.status })) ?? [],
      };
      try {
        const result = await input.runner.run({
          definition: projectAnswerDigestAgentDefinition,
          value: agentInput,
          signal: context.signal,
        });
        const digest = assertAnswerDigest(result.output, source.answerRevision.answer);
        const dimensions = new Set<string>();
        for (const update of digest.coverageUpdates) {
          if (dimensions.has(update.dimension)) {
            throw new DomainError(
              'INTERVIEW_EVIDENCE_INVALID',
              'Coverage dimension appears more than once.',
            );
          }
          dimensions.add(update.dimension);
        }
        const now = context.clock.now();
        const knowledgeItems = digest.knowledgeItems.map((item) => ({
          id: parseId(input.ids.generate(), 'ProjectKnowledgeItem'),
          dossierId: source.dossier.id,
          sourceAnswerRevisionId: source.answerRevision.id,
          ...item,
          status: 'active' as const,
          createdAt: now,
        }));
        const coverage = digest.coverageUpdates.map((update) => ({
          sessionId: source.session.id,
          dimension: update.dimension,
          status: update.status,
          evidenceItemIds: update.evidenceItemIndexes.map((index) => {
            const item = knowledgeItems[index];
            if (!item) {
              throw new TaskExecutionError(
                'validation_failed',
                'Interview coverage references missing evidence.',
              );
            }
            return item.id;
          }),
          updatedAt: now,
        }));
        const committed = input.repository.completeAnswerDigest({
          turnId,
          answerRevisionId,
          expectedSessionRevision: source.session.contextRevision,
          agentRunId: parseId(result.run.id, 'AgentRun'),
          knowledgeItems,
          coverage,
          now,
        });
        if (!committed) {
          throw new TaskExecutionError('cancelled', 'Interview answer result became stale.');
        }
        input.onCommitted?.(payload.dossierId);
        return {
          turnId,
          answerRevisionId,
          agentRunId: result.run.id,
          cacheHit: result.cacheHit,
          knowledgeItems: knowledgeItems.length,
        };
      } catch (error) {
        if (error instanceof AgentRuntimeError) {
          throw mapAgentRuntimeError(error, 'Interview answer Agent');
        }
        if (error instanceof DomainError || error instanceof z.ZodError) {
          throw new TaskExecutionError(
            'validation_failed',
            'Interview answer output was rejected.',
            {
              cause: error,
            },
          );
        }
        throw error;
      }
    },
  };
}

export function createProjectNotebookTaskHandler(input: {
  readonly repository: InterviewProjectRepository;
  readonly artifacts: ArtifactStore;
  readonly ids: IdGenerator;
}): TaskHandler<
  z.infer<typeof projectNotebookTaskPayloadSchema>,
  z.infer<typeof projectNotebookTaskOutputSchema>
> {
  return {
    taskType: 'interview.project-notebook.render',
    payloadSchema: projectNotebookTaskPayloadSchema,
    outputSchema: projectNotebookTaskOutputSchema,
    defaultMaxAttempts: 3,
    leaseDurationMs: 60_000,
    concurrencyKey: (payload) => `interview-dossier:${payload.dossierId}`,
    async execute(context, payload) {
      const dossierId = parseId(payload.dossierId, 'ProjectDossier');
      const detail = input.repository.getDossier(dossierId);
      if (!detail) throw new TaskExecutionError('validation_failed', 'Project dossier is missing.');
      if (detail.dossier.revision !== payload.sourceRevision) {
        return { dossierId, rendered: false, artifactId: null };
      }
      const markdown = renderProjectNotebook(detail);
      const sourceHash = contentHash(markdown);
      if (
        detail.dossier.notebookSourceHash === sourceHash &&
        detail.dossier.latestNotebookArtifactId
      ) {
        return {
          dossierId,
          rendered: false,
          artifactId: detail.dossier.latestNotebookArtifactId,
        };
      }
      const artifact = await input.artifacts.put({
        id: input.ids.generate(),
        kind: 'export',
        mediaType: 'text/markdown; charset=utf-8',
        content: new TextEncoder().encode(markdown),
        createdAt: context.clock.now(),
      });
      const committed = input.repository.updateNotebook({
        dossierId,
        expectedRevision: payload.sourceRevision,
        artifactId: artifact.id,
        sourceHash,
        now: context.clock.now(),
      });
      return { dossierId, rendered: committed, artifactId: committed ? artifact.id : null };
    },
  };
}
