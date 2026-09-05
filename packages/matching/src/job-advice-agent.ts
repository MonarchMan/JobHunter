import { AgentRuntimeError, defineAgent } from '@jobhunter/agent-core';
import { candidateProfileSchema, normalizedJobSchema } from '@jobhunter/domain';
import { z } from 'zod';
import { deterministicMatchOutputSchema } from './model.js';
import { jobAdvicePromptV2 } from './prompts/job-advice/v2.js';

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

/** 模型输出只携带目录 ID；持久化结构继续使用经系统还原的原文引用。 */
const referencePointSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    references: z
      .array(z.string().regex(/^ref-[1-9]\d*$/))
      .min(1)
      .max(8),
  })
  .strict();
export const jobAdviceModelOutputSchema = jobAdviceSchema.extend({
  highlights: z.array(referencePointSchema).max(10),
  gaps: z.array(referencePointSchema).max(10),
  uncertainties: z.array(referencePointSchema).max(10),
});

/** 从确定性评分证据构造有序去重目录，ID 只在当前输入范围内有效。 */
export function buildJobAdviceReferenceCatalog(
  input: JobAdviceInput,
): { id: string; kind: 'evidence' | 'missing' | 'uncertainty'; value: string }[] {
  const references = new Map<string, z.infer<typeof adviceReferenceSchema>>();
  // 1、按评分组件与规则的稳定顺序收集证据，同种类同原文只分配一个 ID。
  const add = (kind: 'evidence' | 'missing' | 'uncertainty', value: string): void => {
    references.set(referenceKey(kind, value), { kind, value });
  };
  for (const component of input.match.components) {
    for (const evidence of component.matchedEvidence) add('evidence', evidence.summary);
    for (const value of component.missingEvidence) add('missing', value);
    for (const value of component.uncertainties) add('uncertainty', value);
  }
  for (const outcome of input.match.ruleOutcomes)
    for (const evidence of outcome.evidence) add('evidence', evidence.summary);
  // 2、目录由系统生成，不接受模型自带的原文或种类。
  return [...references.values()].map((reference, index) => ({
    id: `ref-${String(index + 1)}`,
    ...reference,
  }));
}

/** 校验 ID 并还原可审计的原文引用；不放宽既有证据边界。 */
export function resolveJobAdviceAgentOutput(value: unknown, input: JobAdviceInput): JobAdvice {
  const output = jobAdviceModelOutputSchema.parse(value);
  const catalog = new Map(
    buildJobAdviceReferenceCatalog(input).map(({ id, ...reference }) => [id, reference]),
  );
  // 1、所有章节使用相同目录，未知 ID 产生安全的业务错误供 Runner 单次纠正。
  const resolve = (
    points: z.infer<typeof referencePointSchema>[],
  ): z.infer<typeof advicePointSchema>[] =>
    points.map((point) => ({
      text: point.text,
      references: point.references.map((id) => {
        const reference = catalog.get(id);
        if (!reference)
          throw new AgentRuntimeError(
            'invalid_output',
            `Unknown reference ID ${id}; use referenceCatalog IDs only.`,
          );
        return reference;
      }),
    }));
  // 2、还原后仍走原文证据验证，数据库/UI 无需改动历史建议格式。
  return parseJobAdviceAgentOutput(
    {
      ...output,
      highlights: resolve(output.highlights),
      gaps: resolve(output.gaps),
      uncertainties: resolve(output.uncertainties),
    },
    input,
  );
}

/** 职位准备建议 Agent 定义。 */
export const jobAdviceAgentDefinition = defineAgent({
  key: jobAdvicePromptV2.agentKey,
  version: '2.0.0',
  promptVersion: jobAdvicePromptV2.promptVersion,
  outputSchemaVersion: jobAdvicePromptV2.outputSchemaVersion,
  outputSchemaName: 'JobAdviceOutput',
  systemPrompt: jobAdvicePromptV2.text,
  inputSchema: jobAdviceInputSchema.extend({
    referenceCatalog: z.array(adviceReferenceSchema.extend({ id: z.string() })),
  }),
  outputSchema: jobAdviceModelOutputSchema,
  validateOutput: (output, input) => {
    resolveJobAdviceAgentOutput(output, input);
  },
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
