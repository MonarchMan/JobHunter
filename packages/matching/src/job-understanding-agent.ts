import { defineAgent } from '@jobhunter/agent-core';
import { z } from 'zod';
import { jobUnderstandingSchema, type JobUnderstanding } from './job-understanding.js';
import { jobUnderstandingPromptV1 } from './prompts/job-understanding/v1.js';

const nullableText = z.string().trim().min(1).nullable();

/** 职位理解 Agent 输入 Schema。 */
export const jobUnderstandingInputSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    experienceText: nullableText,
    educationText: nullableText,
  })
  .strict();

/** 模块使用的类型约束。 */
export type JobUnderstandingInput = z.infer<typeof jobUnderstandingInputSchema>;

/** 职位理解 Agent 定义。 */
export const jobUnderstandingAgentDefinition = defineAgent({
  key: jobUnderstandingPromptV1.agentKey,
  version: '1.0.0',
  promptVersion: jobUnderstandingPromptV1.promptVersion,
  outputSchemaVersion: jobUnderstandingPromptV1.outputSchemaVersion,
  outputSchemaName: 'JobUnderstandingOutput',
  systemPrompt: jobUnderstandingPromptV1.text,
  inputSchema: jobUnderstandingInputSchema,
  outputSchema: jobUnderstandingSchema,
  tools: [],
  limits: {
    timeoutMs: 90_000,
    maxSteps: 2,
    maxInputTokens: 24_000,
    maxOutputTokens: 4_000,
    maxEstimatedCostMicros: 200_000,
  },
});

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
function allEvidence(
  value: unknown,
): readonly { field: keyof JobUnderstandingInput; quote: string }[] {
  const evidence: { field: keyof JobUnderstandingInput; quote: string }[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    const record = current as Readonly<Record<string, unknown>>;
    if (typeof record.field === 'string' && typeof record.quote === 'string') {
      evidence.push({ field: record.field as keyof JobUnderstandingInput, quote: record.quote });
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return evidence;
}

/** 校验 Agent 输出并限制证据只能来自输入正文。 */
export function parseJobUnderstandingAgentOutput(
  output: unknown,
  input: JobUnderstandingInput,
): JobUnderstanding {
  const parsed = jobUnderstandingSchema.parse(output);
  for (const reference of allEvidence(parsed)) {
    const source = input[reference.field];
    if (!source?.includes(reference.quote)) {
      throw new TypeError(`Job understanding evidence is not present in ${reference.field}.`);
    }
  }
  return parsed;
}
