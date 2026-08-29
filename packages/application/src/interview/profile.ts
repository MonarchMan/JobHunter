import { hashCanonical } from '@jobhunter/agent-core';
import { parseContentHash } from '@jobhunter/domain';

export const resumeOnlyDrillProfile = Object.freeze({
  key: 'resume-only' as const,
  version: 'v1' as const,
  evidenceKinds: ['resume_project', 'user_answer', 'derived_claim'] as const,
  tools: [] as const,
  questionAgent: 'interview.project-question@v1',
  answerDigestAgent: 'interview.project-answer-digest@v1',
});

export const resumeOnlyDrillProfileDefinitionHash = parseContentHash(
  hashCanonical(resumeOnlyDrillProfile),
);
