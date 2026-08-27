import { defineAgent } from '@jobhunter/agent-core';
import { z } from 'zod';
import { resumePolishPromptV1 } from './prompts/resume-polish/v1.js';

const text = z.string().trim().min(1).max(1_000);

export const resumePolishSectionSchema = z.enum(['workExperience', 'projects']);
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

export const resumePolishAgentInputSchema = z
  .object({
    targetRole: text.max(100),
    selectedSections: z.array(resumePolishSectionSchema).min(1).max(2),
    workExperience: z.array(workExperienceInputSchema).max(50).nullable(),
    projects: z.array(projectInputSchema).max(50).nullable(),
  })
  .strict();

export type ResumePolishAgentInput = z.infer<typeof resumePolishAgentInputSchema>;

export const resumePolishAgentOutputSchema = z
  .object({
    workExperience: z.array(z.array(text).max(20)).max(50).nullable(),
    projects: z.array(z.array(text).max(20)).max(50).nullable(),
  })
  .strict();

export type ResumePolishAgentOutput = z.infer<typeof resumePolishAgentOutputSchema>;

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

export function parseResumePolishAgentOutput(
  output: unknown,
  input: ResumePolishAgentInput,
): ResumePolishAgentOutput {
  const parsed = resumePolishAgentOutputSchema.parse(output);
  for (const section of resumePolishSectionSchema.options) {
    const selected = input.selectedSections.includes(section);
    const source = input[section];
    const result = parsed[section];
    if (!selected && result !== null) {
      throw new TypeError(`Unselected resume section returned content: ${section}`);
    }
    if (selected && (source === null || result === null || result.length !== source.length)) {
      throw new TypeError(`Resume polish output does not match source section: ${section}`);
    }
  }
  return parsed;
}
