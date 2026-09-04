import { hashCanonical } from '@jobhunter/agent-core';
import { parseContentHash, type ContentHash } from '@jobhunter/domain';

/** 仅依据简历与用户回答进行渐进式项目拷打，不访问项目资料。 */
export const resumeOnlyDrillProfile = Object.freeze({
  key: 'resume-only' as const,
  version: 'v1' as const,
  evidenceKinds: ['resume_project', 'user_answer', 'derived_claim'] as const,
  tools: [] as const,
  questionAgent: 'interview.project-question@v1',
  answerDigestAgent: 'interview.project-answer-digest@v1',
});

/** 允许读取已冻结项目 Markdown 资料，并要求问题引用资料证据。 */
export const docsGroundedDrillProfile = Object.freeze({
  key: 'docs-grounded' as const,
  version: 'v1' as const,
  evidenceKinds: ['resume_project', 'user_answer', 'derived_claim', 'project_material'] as const,
  tools: ['selected_markdown_heading_search', 'selected_markdown_chunk_read'] as const,
  questionAgent: 'interview.project-question-docs@v1',
  answerDigestAgent: 'interview.project-answer-digest@v1',
});

/** 应用服务使用的稳定配置或常量。 */
export const resumeOnlyDrillProfileDefinitionHash = parseContentHash(
  hashCanonical(resumeOnlyDrillProfile),
);

/** 应用服务使用的稳定配置或常量。 */
export const docsGroundedDrillProfileDefinitionHash = parseContentHash(
  hashCanonical(docsGroundedDrillProfile),
);

/** 应用层使用的类型约束。 */
export type DrillProfileKey =
  typeof resumeOnlyDrillProfile.key | typeof docsGroundedDrillProfile.key;

/** 根据档位键返回不可变的拷打配置。 */
export function drillProfile(
  key: DrillProfileKey,
): typeof resumeOnlyDrillProfile | typeof docsGroundedDrillProfile {
  return key === 'docs-grounded' ? docsGroundedDrillProfile : resumeOnlyDrillProfile;
}

/** 返回配置定义哈希，用于任务和会话的版本一致性校验。 */
export function drillProfileDefinitionHash(key: DrillProfileKey): ContentHash {
  return key === 'docs-grounded'
    ? docsGroundedDrillProfileDefinitionHash
    : resumeOnlyDrillProfileDefinitionHash;
}
