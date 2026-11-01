import type { AgentDefinition } from './definition.js';

/** 模块数据结构或契约。 */
export interface PromptDescriptor {
  readonly agentKey: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly text: string;
}

/** 确认 Prompt 元数据和 Agent 定义完全一致，避免版本错配。 */
export function assertPromptMatchesDefinition<TInput, TOutput>(
  prompt: PromptDescriptor,
  definition: AgentDefinition<TInput, TOutput>,
): void {
  if (
    prompt.agentKey !== definition.key ||
    prompt.promptVersion !== definition.promptVersion ||
    prompt.outputSchemaVersion !== definition.outputSchemaVersion ||
    prompt.text !== definition.systemPrompt
  ) {
    throw new TypeError(`Prompt metadata does not match Agent definition: ${definition.key}.`);
  }
}

/** 进程内提示词注册表，按 Agent 键和提示词版本索引。 */
export class PromptRegistry {
  readonly #prompts = new Map<string, PromptDescriptor>();

  public register(prompt: PromptDescriptor): void {
    // 1、先校验最小元数据，再拒绝同一版本的重复登记。
    if (!prompt.agentKey.trim() || !prompt.promptVersion.trim() || !prompt.text.trim()) {
      throw new TypeError('Prompt agent key, version and text are required.');
    }
    const key = `${prompt.agentKey}@${prompt.promptVersion}`;
    if (this.#prompts.has(key)) throw new TypeError(`Duplicate prompt: ${key}.`);
    this.#prompts.set(key, Object.freeze(prompt));
  }

  /** 执行模块组件对外暴露的操作。 */
  public get(agentKey: string, promptVersion: string): PromptDescriptor | null {
    return this.#prompts.get(`${agentKey}@${promptVersion}`) ?? null;
  }
}
