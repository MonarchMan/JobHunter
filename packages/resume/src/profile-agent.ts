import { defineAgent } from '@jobhunter/agent-core';
import { z } from 'zod';
import { resumeProfileAgentOutputSchema } from './profile-schema/index.js';
import { resumeProfilePromptV2 } from './prompts/resume-profile/v2.js';

/** 简历画像 Agent 的输入约束，只允许传入已提取的简历文本。 */
export const resumeProfileAgentInputSchema = z
  .object({ extractedText: z.string().min(80).max(250_000) })
  .strict();

/** 模块使用的类型约束。 */
export type ResumeProfileAgentInput = z.infer<typeof resumeProfileAgentInputSchema>;

/** 画像提取 Agent 定义；该 Agent 无工具，只能依据简历文本返回结构化事实。 */
export const resumeProfileAgentDefinition = defineAgent({
  key: resumeProfilePromptV2.agentKey,
  version: '2.0.0',
  promptVersion: resumeProfilePromptV2.promptVersion,
  outputSchemaVersion: resumeProfilePromptV2.outputSchemaVersion,
  outputSchemaName: 'ResumeProfileOutput',
  systemPrompt: resumeProfilePromptV2.text,
  inputSchema: resumeProfileAgentInputSchema,
  outputSchema: resumeProfileAgentOutputSchema,
  tools: [],
  limits: {
    timeoutMs: 120_000,
    maxSteps: 2,
    maxInputTokens: 64_000,
    maxOutputTokens: 12_000,
    maxEstimatedCostMicros: 500_000,
  },
});
