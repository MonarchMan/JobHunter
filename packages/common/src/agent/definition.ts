import { z } from 'zod';
import { hashCanonical } from './canonical.js';
import type { ToolDefinition } from './tools.js';

/** 模块数据结构或契约。 */
export interface AgentLimits {
  readonly timeoutMs: number;
  readonly maxSteps: number;
  readonly maxInputTokens: number;
  /** 模型单次输出上限；未设置时由供应商自身决定。 */
  readonly maxOutputTokens?: number;
  readonly maxEstimatedCostMicros: number;
}

/** 模块数据结构或契约。 */
export interface AgentDefinition<TInput, TOutput> {
  readonly key: string;
  readonly outputSchemaVersion: string;
  readonly outputSchemaName: string;
  readonly systemPrompt: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  /** 纯业务校验；不合法时抛出 invalid_output，摘要只包含安全的纠正信息。 */
  readonly validateOutput?: (output: TOutput, input: TInput) => void;
  readonly tools: readonly ToolDefinition<unknown, unknown>[];
  readonly limits: AgentLimits;
}

/** 根据实际执行内容隔离缓存，定义变化不再依赖人工递增版本号。 */
export function agentDefinitionHash<TInput, TOutput>(
  definition: AgentDefinition<TInput, TOutput>,
): string {
  return hashCanonical({
    key: definition.key,
    prompt: definition.systemPrompt,
    input: z.toJSONSchema(definition.inputSchema, { unrepresentable: 'any' }),
    output: z.toJSONSchema(definition.outputSchema, { unrepresentable: 'any' }),
    validateOutput: definition.validateOutput?.toString() ?? null,
    tools: definition.tools.map((tool) => ({
      key: tool.key,
      description: tool.description,
      input: z.toJSONSchema(tool.inputSchema, { unrepresentable: 'any' }),
      output: z.toJSONSchema(tool.outputSchema, { unrepresentable: 'any' }),
      execute: tool.execute.toString(),
    })),
    limits: definition.limits,
  });
}

/** 校验并冻结 Agent 定义，确保运行时元数据和工具键唯一。 */
export function defineAgent<TInput, TOutput>(
  definition: AgentDefinition<TInput, TOutput>,
): AgentDefinition<TInput, TOutput> {
  if (!definition.key.trim()) throw new TypeError('Agent key is required.');
  if (!definition.outputSchemaVersion.trim() || !definition.outputSchemaName.trim()) {
    throw new TypeError('Agent output schema name and version are required.');
  }
  if (!definition.systemPrompt.trim()) throw new TypeError('Agent system prompt is required.');
  // 1、校验提示词和运行上限，防止无界模型调用。
  const limits = definition.limits;
  for (const [key, value] of Object.entries(limits)) {
    if (value === undefined) continue;
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
