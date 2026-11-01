import type { z } from 'zod';

/** 模块数据结构或契约。 */
export interface ToolExecutionContext {
  readonly signal: AbortSignal;
}

/** 模块数据结构或契约。 */
export interface ToolDefinition<TInput, TOutput> {
  readonly key: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly summarizeInput: (input: TInput) => unknown;
  readonly summarizeOutput: (output: TOutput) => unknown;
  readonly execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

/** 运行期工具注册表，拒绝重复键和任何非只读工具。 */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<unknown, unknown>>();

  public constructor(tools: readonly ToolDefinition<unknown, unknown>[] = []) {
    // 按定义顺序登记工具，使重复键在 Agent 启动时立即暴露。
    for (const tool of tools) this.register(tool);
  }

  public register(tool: ToolDefinition<unknown, unknown>): void {
    if (!tool.key.trim()) throw new TypeError('Tool key is required.');
    if (!tool.readOnly) throw new TypeError(`Tool ${tool.key} must be read-only.`);
    if (this.#tools.has(tool.key)) throw new TypeError(`Duplicate tool: ${tool.key}.`);
    this.#tools.set(tool.key, tool);
  }

  /** 执行模块组件对外暴露的操作。 */
  public get(key: string): ToolDefinition<unknown, unknown> | null {
    return this.#tools.get(key) ?? null;
  }
}
