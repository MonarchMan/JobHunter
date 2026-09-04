import { defineAgent } from '@jobhunter/agent-core';
import { candidateProfileSchema, normalizedJobSchema } from '@jobhunter/domain';
import { z } from 'zod';
import { deterministicMatchOutputSchema } from './model.js';
import { jobAdvicePromptV1 } from './prompts/job-advice/v1.js';

/** 建议引用的职位或简历证据。 */
export const adviceReferenceSchema = z
  .object({
    kind: z.enum(['evidence', 'missing', 'uncertainty']),
    value: z.string().trim().min(1).max(500),
  })
  .strict();

const advicePointSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    references: z.array(adviceReferenceSchema).min(1).max(8),
  })
  .strict();

/** 职位准备建议结构。 */
export const jobAdviceSchema = z
  .object({
    highlights: z.array(advicePointSchema).max(10),
    gaps: z.array(advicePointSchema).max(10),
    uncertainties: z.array(advicePointSchema).max(10),
    resumeEmphasis: z.array(z.string().trim().min(1).max(500)).max(10),
    preparation: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobAdvice = z.infer<typeof jobAdviceSchema>;

/** 职位建议 Agent 输入 Schema。 */
export const jobAdviceInputSchema = z
  .object({
    profile: candidateProfileSchema,
    job: normalizedJobSchema,
    match: deterministicMatchOutputSchema,
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobAdviceInput = z.infer<typeof jobAdviceInputSchema>;

/** 职位准备建议 Agent 定义。 */
export const jobAdviceAgentDefinition = defineAgent({
  key: jobAdvicePromptV1.agentKey,
  version: '1.0.0',
  promptVersion: jobAdvicePromptV1.promptVersion,
  outputSchemaVersion: jobAdvicePromptV1.outputSchemaVersion,
  outputSchemaName: 'JobAdviceOutput',
  systemPrompt: jobAdvicePromptV1.text,
  inputSchema: jobAdviceInputSchema,
  outputSchema: jobAdviceSchema,
  tools: [],
  limits: {
    timeoutMs: 90_000,
    maxSteps: 2,
    maxInputTokens: 32_000,
    maxOutputTokens: 4_000,
    maxEstimatedCostMicros: 200_000,
  },
});

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function referenceKey(kind: z.infer<typeof adviceReferenceSchema>['kind'], value: string): string {
  return `${kind}\u0000${value}`;
}

/** 校验建议 Agent 输出并验证引用边界。 */
export function parseJobAdviceAgentOutput(output: unknown, input: JobAdviceInput): JobAdvice {
  const parsed = jobAdviceSchema.parse(output);
  const allowed = new Set<string>();
  for (const component of input.match.components) {
    for (const evidence of component.matchedEvidence) {
      allowed.add(referenceKey('evidence', evidence.summary));
    }
    for (const value of component.missingEvidence) allowed.add(referenceKey('missing', value));
    for (const value of component.uncertainties) allowed.add(referenceKey('uncertainty', value));
  }
  for (const outcome of input.match.ruleOutcomes) {
    for (const evidence of outcome.evidence) {
      allowed.add(referenceKey('evidence', evidence.summary));
    }
  }
  for (const section of [parsed.highlights, parsed.gaps, parsed.uncertainties]) {
    for (const point of section) {
      for (const reference of point.references) {
        if (!allowed.has(referenceKey(reference.kind, reference.value))) {
          throw new TypeError('Job advice contains a reference absent from the match evidence.');
        }
      }
    }
  }
  return parsed;
}
