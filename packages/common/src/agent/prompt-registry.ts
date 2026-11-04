import type { AgentDefinition } from './definition.js';

/** 模块数据结构或契约。 */
export interface PromptDescriptor {
  readonly agentKey: string;
  readonly outputSchemaVersion: string;
  readonly text: string;
}

/** 确认当前 Prompt 内容、功能身份和输出契约与 Agent 定义一致。 */
export function assertPromptMatchesDefinition<TInput, TOutput>(
  prompt: PromptDescriptor,
  definition: AgentDefinition<TInput, TOutput>,
): void {
  if (
    prompt.agentKey !== definition.key ||
    prompt.outputSchemaVersion !== definition.outputSchemaVersion ||
    prompt.text !== definition.systemPrompt
  ) {
    throw new TypeError(`Prompt metadata does not match Agent definition: ${definition.key}.`);
  }
}

/** 进程内提示词注册表，每个功能只登记当前提示词。 */
export class PromptRegistry {
  readonly #prompts = new Map<string, PromptDescriptor>();

  public register(prompt: PromptDescriptor): void {
    // 1、校验最小元数据，再拒绝同一功能的重复登记。
    if (!prompt.agentKey.trim() || !prompt.text.trim()) {
      throw new TypeError('Prompt agent key and text are required.');
    }
    const key = prompt.agentKey;
    if (this.#prompts.has(key)) throw new TypeError(`Duplicate prompt: ${key}.`);
    this.#prompts.set(key, Object.freeze(prompt));
  }

  /** 执行模块组件对外暴露的操作。 */
  public get(agentKey: string): PromptDescriptor | null {
    return this.#prompts.get(agentKey) ?? null;
  }
}
