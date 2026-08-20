import type { z } from 'zod';
import type { ToolDefinition } from './tools.js';

export interface AgentLimits {
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxEstimatedCostMicros: number;
}

export interface AgentDefinition<TInput, TOutput> {
  readonly key: string;
  readonly version: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly outputSchemaName: string;
  readonly systemPrompt: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly tools: readonly ToolDefinition<unknown, unknown>[];
  readonly limits: AgentLimits;
}

export function defineAgent<TInput, TOutput>(
  definition: AgentDefinition<TInput, TOutput>,
): AgentDefinition<TInput, TOutput> {
  if (!definition.key.trim()) throw new TypeError('Agent key is required.');
  if (!definition.version.trim() || !definition.promptVersion.trim()) {
    throw new TypeError('Agent and prompt versions are required.');
  }
  if (!definition.outputSchemaVersion.trim() || !definition.outputSchemaName.trim()) {
    throw new TypeError('Agent output schema name and version are required.');
  }
  if (!definition.systemPrompt.trim()) throw new TypeError('Agent system prompt is required.');
  const limits = definition.limits;
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Agent limit ${key} must be a positive integer.`);
    }
  }
  const toolKeys = new Set<string>();
  for (const tool of definition.tools) {
    if (toolKeys.has(tool.key)) throw new TypeError(`Duplicate agent tool: ${tool.key}.`);
    toolKeys.add(tool.key);
  }
  return Object.freeze(definition);
}
