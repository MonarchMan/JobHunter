import { defineAgent } from '@jobhunter/agent-core';
import { z } from 'zod';
import { resumeProfileAgentOutputSchema } from './profile-schema/index.js';
import { resumeProfilePromptV1 } from './prompts/resume-profile/v1.js';

export const resumeProfileAgentInputSchema = z
  .object({ extractedText: z.string().min(80).max(250_000) })
  .strict();

export type ResumeProfileAgentInput = z.infer<typeof resumeProfileAgentInputSchema>;

export const resumeProfileAgentDefinition = defineAgent({
  key: resumeProfilePromptV1.agentKey,
  version: '1.0.0',
  promptVersion: resumeProfilePromptV1.promptVersion,
  outputSchemaVersion: resumeProfilePromptV1.outputSchemaVersion,
  outputSchemaName: 'ResumeProfileOutput',
  systemPrompt: resumeProfilePromptV1.text,
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
