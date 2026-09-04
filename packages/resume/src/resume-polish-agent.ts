import { defineAgent } from '@jobhunter/agent-core';
import { z } from 'zod';
import { resumePolishPromptV1 } from './prompts/resume-polish/v1.js';

const text = z.string().trim().min(1).max(1_000);

/** 允许交给润色 Agent 处理的简历章节。 */
export const resumePolishSectionSchema = z.enum(['workExperience', 'projects']);
/** 模块使用的类型约束。 */
export type ResumePolishSection = z.infer<typeof resumePolishSectionSchema>;

const workExperienceInputSchema = z
  .object({
    organization: text.nullable(),
    title: text,
    highlights: z.array(text).max(20),
  })
  .strict();

const projectInputSchema = z
  .object({
    name: text,
    role: text.nullable(),
    highlights: z.array(text).max(20),
  })
  .strict();

/** 润色 Agent 输入，只携带目标岗位和用户选中的经历内容。 */
export const resumePolishAgentInputSchema = z
  .object({
    targetRole: text.max(100),
    selectedSections: z.array(resumePolishSectionSchema).min(1).max(2),
    workExperience: z.array(workExperienceInputSchema).max(50).nullable(),
    projects: z.array(projectInputSchema).max(50).nullable(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type ResumePolishAgentInput = z.infer<typeof resumePolishAgentInputSchema>;

/** 润色 Agent 输出，只允许返回与输入条目逐项对应的描述数组。 */
export const resumePolishAgentOutputSchema = z
  .object({
    workExperience: z.array(z.array(text).max(20)).max(50).nullable(),
    projects: z.array(z.array(text).max(20)).max(50).nullable(),
  })
  .strict();

/** 模块使用的类型约束。 */
export type ResumePolishAgentOutput = z.infer<typeof resumePolishAgentOutputSchema>;

/** 简历润色 Agent 定义；无工具且不得新增输入中不存在的事实。 */
export const resumePolishAgentDefinition = defineAgent({
  key: resumePolishPromptV1.agentKey,
  version: '1.0.0',
  promptVersion: resumePolishPromptV1.promptVersion,
  outputSchemaVersion: resumePolishPromptV1.outputSchemaVersion,
  outputSchemaName: 'ResumePolishOutput',
  systemPrompt: resumePolishPromptV1.text,
  inputSchema: resumePolishAgentInputSchema,
  outputSchema: resumePolishAgentOutputSchema,
  tools: [],
  limits: {
    timeoutMs: 120_000,
    maxSteps: 2,
    maxInputTokens: 32_000,
    maxOutputTokens: 8_000,
    maxEstimatedCostMicros: 300_000,
  },
});

/** 执行模块的解析、转换、评分或调用辅助逻辑。 */
export function parseResumePolishAgentOutput(
  output: unknown,
  input: ResumePolishAgentInput,
): ResumePolishAgentOutput {
  // 1、校验模型结构，再逐章节确认选择范围和条目数量没有被模型改变。
  const parsed = resumePolishAgentOutputSchema.parse(output);
  for (const section of resumePolishSectionSchema.options) {
    const selected = input.selectedSections.includes(section);
    const source = input[section];
    const result = parsed[section];
    if (!selected && result !== null) {
      throw new TypeError(`Unselected resume section returned content: ${section}`);
    }
    if (selected && (source?.length !== result?.length || source === null)) {
      throw new TypeError(`Resume polish output does not match source section: ${section}`);
    }
  }
  return parsed;
}
