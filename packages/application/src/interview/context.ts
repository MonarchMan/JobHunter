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
    materialBindings: session.materialBindings,
    turnNo,
  });
}

const dimensionTerms: Readonly<Record<string, readonly string[]>> = {
  background_goal: ['背景', '目标', '问题', '范围'],
  personal_responsibility: ['职责', '负责', '贡献', '角色'],
  architecture_design: ['架构', '模块', '接口', '数据流'],
  key_implementation: ['实现', '流程', '算法', '组件'],
  technical_tradeoff: ['取舍', '方案', '选择', '替代'],
  data_metrics: ['指标', '性能', '规模', '数据'],
  incident_debugging: ['故障', '异常', '排查', '恢复'],
  collaboration_delivery: ['协作', '推进', '交付', '分工'],
  security_quality: ['安全', '质量', '测试', '监控'],
  reflection_evolution: ['复盘', '改进', '演进', '遗留'],
};

function searchTerms(context: ProjectQuestionContext): readonly string[] {
  const terms = new Set<string>();
  const source = [
    context.snapshot.project.name,
    ...context.snapshot.project.highlights,
    ...context.history.slice(-3).flatMap((item) => [item.question, item.answer]),
  ].join('\n');
  for (const token of source.toLocaleLowerCase('zh-CN').split(/[^\p{Letter}\p{Number}]+/gu)) {
    if (token.length >= 2 && token.length <= 40) terms.add(token);
  }
  for (const coverage of context.coverage) {
    if (coverage.status === 'unasked' || coverage.status === 'needs_clarification') {
      for (const term of dimensionTerms[coverage.dimension] ?? []) terms.add(term);
    }
  }
  return [...terms].slice(0, 80);
}

function selectedMaterials(
  context: ProjectQuestionContext,
): ProjectQuestionAgentInput['materials'] {
  const terms = searchTerms(context);
  const candidates = context.materials.flatMap((material, fileIndex) =>
    material.chunks.map((chunk) => {
      const searchable = `${chunk.heading ?? ''}\n${chunk.text}`.toLocaleLowerCase('zh-CN');
      const score = terms.reduce(
        (total, term) => total + (searchable.includes(term.toLocaleLowerCase('zh-CN')) ? 1 : 0),
        0,
      );
      return { material, chunk, fileIndex, score };
    }),
  );
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.fileIndex - right.fileIndex ||
      left.chunk.start - right.chunk.start,
  );
  const noKeywordMatch = candidates.every((candidate) => candidate.score === 0);
  const fallbackFirstChunks = noKeywordMatch
    ? candidates.filter((candidate) => candidate.material.chunks[0]?.id === candidate.chunk.id)
    : [];
  const fallbackFirstIds = new Set(fallbackFirstChunks.map((candidate) => candidate.chunk.id));
  const orderedCandidates = noKeywordMatch
    ? [
        ...fallbackFirstChunks,
        ...candidates.filter((candidate) => !fallbackFirstIds.has(candidate.chunk.id)),
      ]
    : candidates;
  const fallbackExcerptLimit = Math.min(
    2_000,
    Math.floor(12_000 / Math.max(1, fallbackFirstChunks.length)),
  );
  const selected: ProjectQuestionAgentInput['materials'][number][] = [];
  let characters = 0;
  for (const candidate of orderedCandidates) {
    if (selected.length >= 12 || characters >= 12_000) break;
    const excerptLimit = fallbackFirstIds.has(candidate.chunk.id)
      ? Math.min(fallbackExcerptLimit, 12_000 - characters)
      : Math.min(2_000, 12_000 - characters);
    const excerpt = candidate.chunk.text.slice(0, excerptLimit).trim();
    if (!excerpt) continue;
    selected.push({
      evidenceRef: { kind: 'project_material', id: candidate.chunk.id },
      fileName: candidate.material.fileName,
      heading: candidate.chunk.heading,
      excerpt,
    });
    characters += excerpt.length;
  }
  return selected;
}

export function buildQuestionAgentInput(
  context: ProjectQuestionContext,
): ProjectQuestionAgentInput {
  const history = context.history.slice(-30);
  const knowledgeItems = context.knowledgeItems.slice(-100);
  const materials = selectedMaterials(context);
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
    materials,
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
      ...materials.map((item) => item.evidenceRef),
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
