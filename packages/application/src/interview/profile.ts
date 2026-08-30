import { hashCanonical } from '@jobhunter/agent-core';
import { parseContentHash, type ContentHash } from '@jobhunter/domain';

export const resumeOnlyDrillProfile = Object.freeze({
  key: 'resume-only' as const,
  version: 'v1' as const,
  evidenceKinds: ['resume_project', 'user_answer', 'derived_claim'] as const,
  tools: [] as const,
  questionAgent: 'interview.project-question@v1',
  answerDigestAgent: 'interview.project-answer-digest@v1',
});

export const docsGroundedDrillProfile = Object.freeze({
  key: 'docs-grounded' as const,
  version: 'v1' as const,
  evidenceKinds: ['resume_project', 'user_answer', 'derived_claim', 'project_material'] as const,
  tools: ['selected_markdown_heading_search', 'selected_markdown_chunk_read'] as const,
  questionAgent: 'interview.project-question-docs@v1',
  answerDigestAgent: 'interview.project-answer-digest@v1',
});

export const resumeOnlyDrillProfileDefinitionHash = parseContentHash(
  hashCanonical(resumeOnlyDrillProfile),
);

export const docsGroundedDrillProfileDefinitionHash = parseContentHash(
  hashCanonical(docsGroundedDrillProfile),
);

export type DrillProfileKey =
  typeof resumeOnlyDrillProfile.key | typeof docsGroundedDrillProfile.key;

export function drillProfile(
  key: DrillProfileKey,
): typeof resumeOnlyDrillProfile | typeof docsGroundedDrillProfile {
  return key === 'docs-grounded' ? docsGroundedDrillProfile : resumeOnlyDrillProfile;
}

export function drillProfileDefinitionHash(key: DrillProfileKey): ContentHash {
  return key === 'docs-grounded'
    ? docsGroundedDrillProfileDefinitionHash
    : resumeOnlyDrillProfileDefinitionHash;
}
