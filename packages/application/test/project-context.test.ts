import { contentHash, parseId, utcInstant } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import { buildQuestionAgentInput } from '../src/interview/context.js';
import type {
  ProjectMaterialContext,
  ProjectQuestionContext,
} from '../src/ports/interview-projects.js';

describe('project question material selection', () => {
  it('falls back to the first chunk of every selected file when no keyword matches', () => {
    const hash = contentHash('fixture');
    const now = utcInstant(1);
    const dossierId = parseId('018f0000-0000-7000-8000-000000000101', 'ProjectDossier');
    const material = (fileIndex: number, chunkCount: number): ProjectMaterialContext => {
      const text = `无关资料${String(fileIndex)}`.repeat(300);
      return {
        dossierId,
        fileId: `018f0000-0000-7000-8000-${String(200 + fileIndex).padStart(12, '0')}`,
        entityId: `018f0000-0000-7000-8000-${String(300 + fileIndex).padStart(12, '0')}`,
        versionNo: 1,
        fileName: `material-${String(fileIndex)}.md`,
        contentHash: hash,
        mediaType: 'text/markdown; charset=utf-8',
        byteSize: text.length,
        chunks: Array.from({ length: chunkCount }, (_, chunkIndex) => ({
          id: parseId(
            `018f0000-0000-7000-8000-${String(1_000 + fileIndex * 100 + chunkIndex).padStart(12, '0')}`,
            'ProjectMaterialChunk',
          ),
          heading: null,
          start: chunkIndex * text.length,
          end: (chunkIndex + 1) * text.length,
          contentHash: contentHash(text),
          text,
        })),
        createdAt: now,
        updatedAt: now,
      };
    };
    const first = material(1, 12);
    const second = material(2, 1);
    const snapshotId = parseId('018f0000-0000-7000-8000-000000000102', 'ResumeProjectSnapshot');
    const sessionId = parseId('018f0000-0000-7000-8000-000000000105', 'DrillSession');
    const context: ProjectQuestionContext = {
      dossier: {
        id: dossierId,
        snapshotId,
        latestNotebookArtifactId: null,
        notebookSourceHash: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
      snapshot: {
        id: snapshotId,
        sourceProfileId: parseId('018f0000-0000-7000-8000-000000000103', 'CandidateProfile'),
        sourceProfileVersionId: parseId('018f0000-0000-7000-8000-000000000104', 'ProfileVersion'),
        projectIndex: 0,
        project: {
          name: '目标项目',
          role: null,
          startDate: null,
          endDate: null,
          highlights: ['用户价值'],
          evidence: [],
        },
        contentHash: hash,
        createdAt: now,
      },
      session: {
        id: sessionId,
        dossierId,
        profileKey: 'docs-grounded',
        profileVersion: 'v1',
        profileDefinitionHash: hash,
        capabilitySummary: { evidenceKinds: ['project_material'], tools: [] },
        materialBindings: [first, second],
        status: 'active',
        contextRevision: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      turn: {
        id: parseId('018f0000-0000-7000-8000-000000000106', 'DrillTurn'),
        sessionId,
        turnNo: 1,
        status: 'question_pending',
        contextHash: hash,
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
      },
      history: [],
      knowledgeItems: [],
      coverage: [],
      materials: [first, second],
    };

    expect(
      buildQuestionAgentInput(context)
        .materials.slice(0, 2)
        .map(({ fileName }) => fileName),
    ).toEqual([first.fileName, second.fileName]);
  });
});
