import type { z } from 'zod';

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
}

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

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<unknown, unknown>>();

  public constructor(tools: readonly ToolDefinition<unknown, unknown>[] = []) {
    for (const tool of tools) this.register(tool);
  }

  public register(tool: ToolDefinition<unknown, unknown>): void {
    if (!tool.key.trim()) throw new TypeError('Tool key is required.');
    if (!tool.readOnly) throw new TypeError(`Tool ${tool.key} must be read-only.`);
    if (this.#tools.has(tool.key)) throw new TypeError(`Duplicate tool: ${tool.key}.`);
    this.#tools.set(tool.key, tool);
  }

  public get(key: string): ToolDefinition<unknown, unknown> | null {
    return this.#tools.get(key) ?? null;
  }
}
