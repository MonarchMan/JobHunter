import { z } from 'zod';
import { DomainError } from '../shared/domain-error.js';

export const drillCoverageDimensions = [
  'background_goal',
  'personal_responsibility',
  'architecture_design',
  'key_implementation',
  'technical_tradeoff',
  'data_metrics',
  'incident_debugging',
  'collaboration_delivery',
  'security_quality',
  'reflection_evolution',
] as const;

export const drillCoverageDimensionSchema = z.enum(drillCoverageDimensions);
export type DrillCoverageDimension = z.infer<typeof drillCoverageDimensionSchema>;

export const drillCoverageStatusSchema = z.enum([
  'unasked',
  'asked',
  'evidence_partial',
  'evidence_sufficient',
  'needs_clarification',
]);
export type DrillCoverageStatus = z.infer<typeof drillCoverageStatusSchema>;

export const drillSessionStatusSchema = z.enum(['active', 'paused', 'completed']);
export type DrillSessionStatus = z.infer<typeof drillSessionStatusSchema>;

export const drillTurnStatusSchema = z.enum([
  'question_pending',
  'awaiting_answer',
  'digest_pending',
  'ready',
  'skipped',
  'cancelled',
]);
export type DrillTurnStatus = z.infer<typeof drillTurnStatusSchema>;

export const drillEvidenceKindSchema = z.enum([
  'resume_project',
  'user_answer',
  'derived_claim',
  'project_material',
]);
export type DrillEvidenceKind = z.infer<typeof drillEvidenceKindSchema>;

export const drillEvidenceRefSchema = z
  .object({
    kind: drillEvidenceKindSchema,
    id: z.uuid(),
  })
  .strict();
export type DrillEvidenceRef = z.infer<typeof drillEvidenceRefSchema>;

export const generatedProjectQuestionSchema = z
  .object({
    question: z.string().trim().min(8).max(600),
    intent: z.string().trim().min(2).max(300),
    primaryDimension: drillCoverageDimensionSchema,
    guidanceSlots: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    evidenceRefs: z.array(drillEvidenceRefSchema).min(1).max(12),
  })
  .strict();
export type GeneratedProjectQuestion = z.infer<typeof generatedProjectQuestionSchema>;

export const projectKnowledgeKindSchema = z.enum([
  'fact',
  'decision',
  'metric',
  'incident',
  'lesson',
  'ambiguity',
  'conflict',
]);
export type ProjectKnowledgeKind = z.infer<typeof projectKnowledgeKindSchema>;

export const answerKnowledgeCandidateSchema = z
  .object({
    kind: projectKnowledgeKindSchema,
    statement: z.string().trim().min(1).max(600),
    quote: z.string().min(1).max(600),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict();

export const answerDigestOutputSchema = z
  .object({
    knowledgeItems: z.array(answerKnowledgeCandidateSchema).max(40),
    coverageUpdates: z
      .array(
        z
          .object({
            dimension: drillCoverageDimensionSchema,
            status: drillCoverageStatusSchema.exclude(['unasked']),
            evidenceItemIndexes: z.array(z.number().int().nonnegative()).max(20),
          })
          .strict(),
      )
      .max(drillCoverageDimensions.length),
  })
  .strict();
export type AnswerDigestOutput = z.infer<typeof answerDigestOutputSchema>;

const unsafeQuestionPatterns = [
  /(?:读取|查看|打开|扫描|遍历|搜索).{0,10}(?:源码|代码库|项目目录|文件系统|git)/iu,
  /(?:run|execute|open|read|scan|search).{0,12}(?:source code|repository|project directory|filesystem|git|shell)/iu,
  /(?:shell|终端|命令行).{0,10}(?:执行|运行|command)/iu,
  /(?:执行|运行|遵循|照做).{0,12}(?:文档|markdown|mdx).{0,8}(?:命令|指令|提示词)/iu,
  /(?:execute|follow|obey).{0,12}(?:document|markdown|mdx).{0,8}(?:command|instruction|prompt)/iu,
  /(?:列出|罗列|展示|给出|描述).{0,16}(?:目录结构|文件列表|文件树|src\s*目录|目录下.{0,8}(?:文件|源码)|有哪些文件)/iu,
  /(?:list|show|enumerate|describe).{0,16}(?:directory tree|folder structure|files?\s+(?:under|inside|in)|src\s+directory)/iu,
  /(?:执行|运行|调用|输入).{0,12}(?:ls|cat|find|grep|rg|git|pwd|tree|sed|awk|curl|wget|npm|pnpm|yarn|node|python|bash|zsh|powershell)(?:\s|$|[-/])/iu,
  /(?:run|execute|invoke|type).{0,12}(?:ls|cat|find|grep|rg|git|pwd|tree|sed|awk|curl|wget|npm|pnpm|yarn|node|python|bash|zsh|powershell)(?:\s|$|[-/])/iu,
  /(?:^|[\s`$;|&])(?:ls|cat|find|grep|rg|git|pwd|tree|sed|awk|curl|wget)(?:\s+-|\s+\.|\s+\/)/imu,
];

const answerLikePatterns = [
  /(?:^|[。！？\n])\s*(?:我|我们)(?:在|负责|通过|采用|设计|实现|首先|最终)/u,
  /(?:^|[.!?\n])\s*(?:I|We)\s+(?:was|were|designed|implemented|built|used|chose|led)\b/iu,
  /(?:建议|推荐|参考|示范|标准|完整)(?:的)?(?:回答|答案|说法)|(?:建议|可以|应该)(?:这样)?(?:回答|作答|说)|(?:回答|答案)\s*[：:]/iu,
  /(?:suggested|recommended|reference|sample|model|complete)\s+(?:answer|response)|(?:you|candidate)\s+(?:can|could|should)\s+(?:answer|say)|(?:answer|response)\s*:/iu,
];

function evidenceKey(ref: DrillEvidenceRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function assertGeneratedProjectQuestion(
  input: unknown,
  allowedEvidence: readonly DrillEvidenceRef[],
): GeneratedProjectQuestion {
  const question = generatedProjectQuestionSchema.parse(input);
  const combined = [question.question, question.intent, ...question.guidanceSlots].join('\n');
  if (unsafeQuestionPatterns.some((pattern) => pattern.test(combined))) {
    throw new DomainError(
      'INTERVIEW_QUESTION_UNSAFE',
      'Generated question requests prohibited project access.',
    );
  }
  if (answerLikePatterns.some((pattern) => pattern.test(combined))) {
    throw new DomainError(
      'INTERVIEW_QUESTION_UNSAFE',
      'Generated question contains answer-like first-person content.',
    );
  }
  const allowed = new Set(allowedEvidence.map(evidenceKey));
  const invalid = question.evidenceRefs.find((ref) => !allowed.has(evidenceKey(ref)));
  if (invalid) {
    throw new DomainError('INTERVIEW_EVIDENCE_INVALID', 'Question evidence is not in context.', {
      kind: invalid.kind,
      id: invalid.id,
    });
  }
  return question;
}

export function assertAnswerDigest(input: unknown, answer: string): AnswerDigestOutput {
  const digest = answerDigestOutputSchema.parse(input);
  for (const [index, item] of digest.knowledgeItems.entries()) {
    if (item.start >= item.end || item.end > answer.length) {
      throw new DomainError('INTERVIEW_EVIDENCE_INVALID', 'Answer evidence offset is invalid.', {
        index,
      });
    }
    if (answer.slice(item.start, item.end) !== item.quote) {
      throw new DomainError('INTERVIEW_EVIDENCE_INVALID', 'Answer evidence quote does not match.', {
        index,
      });
    }
  }
  for (const update of digest.coverageUpdates) {
    if (update.evidenceItemIndexes.some((index) => index >= digest.knowledgeItems.length)) {
      throw new DomainError('INTERVIEW_EVIDENCE_INVALID', 'Coverage evidence index is invalid.', {
        dimension: update.dimension,
      });
    }
  }
  return digest;
}

export function assertCanRequestQuestion(
  sessionStatus: DrillSessionStatus,
  latestTurnStatus: DrillTurnStatus | null,
): void {
  if (sessionStatus !== 'active') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'Only active sessions accept questions.');
  }
  if (latestTurnStatus !== null && !['ready', 'skipped', 'cancelled'].includes(latestTurnStatus)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      'The current turn must be resolved before requesting another question.',
    );
  }
}

export function assertCanSubmitAnswer(
  sessionStatus: DrillSessionStatus,
  turnStatus: DrillTurnStatus,
): void {
  if (sessionStatus !== 'active' || !['awaiting_answer', 'ready'].includes(turnStatus)) {
    throw new DomainError('INVALID_STATE_TRANSITION', 'This turn does not accept an answer.');
  }
}

export function nextSessionStatus(
  current: DrillSessionStatus,
  action: 'pause' | 'resume' | 'complete',
): DrillSessionStatus {
  if (action === 'pause' && current === 'active') return 'paused';
  if (action === 'resume' && current === 'paused') return 'active';
  if (action === 'complete' && current !== 'completed') return 'completed';
  throw new DomainError('INVALID_STATE_TRANSITION', 'Interview session transition is invalid.', {
    current,
    action,
  });
}
