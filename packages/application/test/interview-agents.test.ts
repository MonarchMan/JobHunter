import { describe, expect, it } from 'vitest';
import {
  projectAnswerDigestAgentDefinition,
  projectQuestionAgentDefinition,
  resumeOnlyDrillProfile,
} from '../src/index.js';

describe('interview Agent contracts', () => {
  it('uses bounded built-in definitions with no tools', () => {
    expect(resumeOnlyDrillProfile).toMatchObject({ key: 'resume-only', version: 'v1' });
    expect(projectQuestionAgentDefinition.tools).toEqual([]);
    expect(projectAnswerDigestAgentDefinition.tools).toEqual([]);
    expect(projectQuestionAgentDefinition.key).toBe('interview.project-question');
    expect(projectAnswerDigestAgentDefinition.key).toBe('interview.project-answer-digest');
  });

  it('strictly validates question context and digest input', () => {
    expect(() =>
      projectQuestionAgentDefinition.inputSchema.parse({
        project: {
          name: 'JobHunter',
          role: '开发者',
          startDate: null,
          endDate: null,
          highlights: ['实现职位同步'],
        },
        history: [],
        knowledgeItems: [],
        coverage: [],
        allowedEvidenceRefs: [
          { kind: 'resume_project', id: '018f0000-0000-7000-8000-000000000101' },
        ],
        sourceCode: 'must be rejected',
      }),
    ).toThrow();

    expect(
      projectAnswerDigestAgentDefinition.inputSchema.parse({
        project: {
          name: 'JobHunter',
          role: null,
          startDate: null,
          endDate: null,
          highlights: [],
        },
        question: '你如何判断目标达成？',
        answer: '我使用了成功率指标。',
        coverage: [],
      }),
    ).toBeTruthy();
  });
});
