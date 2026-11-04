import { defineAgent } from '@jobhunter/common/agent';
import { z } from 'zod';
import { resumeProfileAgentOutputSchema } from './profile-schema/index.js';
import { resumeProfilePrompt } from './prompts/resume-profile.js';

/** 简历画像 Agent 的输入约束，只允许传入已提取的简历文本。 */
export const resumeProfileAgentInputSchema = z
  .object({ extractedText: z.string().min(80).max(250_000) })
  .strict();

/** 模块使用的类型约束。 */
export type ResumeProfileAgentInput = z.infer<typeof resumeProfileAgentInputSchema>;

/** 画像提取 Agent 定义；该 Agent 无工具，只能依据简历文本返回结构化事实。 */
export const resumeProfileAgentDefinition = defineAgent({
  key: resumeProfilePrompt.agentKey,
  outputSchemaVersion: resumeProfilePrompt.outputSchemaVersion,
  outputSchemaName: 'ResumeProfileOutput',
  systemPrompt: resumeProfilePrompt.text,
  inputSchema: resumeProfileAgentInputSchema,
  outputSchema: resumeProfileAgentOutputSchema,
  tools: [],
  limits: {
    timeoutMs: 240_000,
    maxSteps: 2,
    maxInputTokens: 64_000,
    maxEstimatedCostMicros: 500_000,
  },
});
