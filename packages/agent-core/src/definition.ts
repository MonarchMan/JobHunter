import type { z } from 'zod';
import type { ToolDefinition } from './tools.js';

/** 模块数据结构或契约。 */
export interface AgentLimits {
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxEstimatedCostMicros: number;
}

/** 模块数据结构或契约。 */
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

/** 校验并冻结 Agent 定义，确保运行时元数据和工具键唯一。 */
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
  // 1、校验版本、提示词和运行上限，防止无界模型调用。
  const limits = definition.limits;
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Agent limit ${key} must be a positive integer.`);
    }
  }
  // 2、校验工具键唯一后冻结定义，避免运行中被调用方修改。
  const toolKeys = new Set<string>();
  for (const tool of definition.tools) {
    if (toolKeys.has(tool.key)) throw new TypeError(`Duplicate agent tool: ${tool.key}.`);
    toolKeys.add(tool.key);
  }
  return Object.freeze(definition);
}
