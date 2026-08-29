import type {
  DrillCoverageRecord,
  DrillSessionRecord,
  DrillTurnRecord,
  ProjectDossierDetail,
  ProjectQuestionContext,
} from '../ports/interview-projects.js';
import { contentHash } from '@jobhunter/domain';
import type { z } from 'zod';
import type { projectQuestionAgentInputSchema } from './agents.js';

export type ProjectQuestionAgentInput = z.infer<typeof projectQuestionAgentInputSchema>;

function project(
  snapshot: ProjectQuestionContext['snapshot'],
): ProjectQuestionAgentInput['project'] {
  return {
    name: snapshot.project.name,
    role: snapshot.project.role,
    startDate: snapshot.project.startDate,
    endDate: snapshot.project.endDate,
    highlights: snapshot.project.highlights,
  };
}

export function questionContextHash(
  session: DrillSessionRecord,
  turnNo: number,
): DrillTurnRecord['contextHash'] {
  return contentHash({
    sessionId: session.id,
    contextRevision: session.contextRevision,
    profileDefinitionHash: session.profileDefinitionHash,
    turnNo,
  });
}

export function buildQuestionAgentInput(
  context: ProjectQuestionContext,
): ProjectQuestionAgentInput {
  const history = context.history.slice(-30);
  const knowledgeItems = context.knowledgeItems.slice(-100);
  return {
    project: project(context.snapshot),
    history: history.map((item) => ({
      question: item.question,
      answer: item.answer,
    })),
    knowledgeItems: knowledgeItems.map((item) => ({
      kind: item.kind,
      statement: item.statement,
    })),
    coverage: context.coverage.map((item) => ({
      dimension: item.dimension,
      status: item.status,
    })),
    allowedEvidenceRefs: [
      { kind: 'resume_project', id: context.snapshot.id },
      ...history.map((item) => ({
        kind: 'user_answer' as const,
        id: item.answerRevisionId,
      })),
      ...knowledgeItems.map((item) => ({
        kind: 'derived_claim' as const,
        id: item.id,
      })),
    ],
  };
}

export function latestTurn(
  detail: ProjectDossierDetail,
  sessionId: DrillSessionRecord['id'],
): DrillTurnRecord | null {
  return (
    detail.turns
      .filter((turn) => turn.sessionId === sessionId)
      .toSorted((left, right) => right.turnNo - left.turnNo)[0] ?? null
  );
}

export function sessionCoverage(
  detail: ProjectDossierDetail,
  sessionId: DrillSessionRecord['id'],
): readonly DrillCoverageRecord[] {
  return detail.coverage.filter((item) => item.sessionId === sessionId);
}
