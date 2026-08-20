import type { AgentDefinition } from './definition.js';

export interface PromptDescriptor {
  readonly agentKey: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly text: string;
}

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

export class PromptRegistry {
  readonly #prompts = new Map<string, PromptDescriptor>();

  public register(prompt: PromptDescriptor): void {
    if (!prompt.agentKey.trim() || !prompt.promptVersion.trim() || !prompt.text.trim()) {
      throw new TypeError('Prompt agent key, version and text are required.');
    }
    const key = `${prompt.agentKey}@${prompt.promptVersion}`;
    if (this.#prompts.has(key)) throw new TypeError(`Duplicate prompt: ${key}.`);
    this.#prompts.set(key, Object.freeze(prompt));
  }

  public get(agentKey: string, promptVersion: string): PromptDescriptor | null {
    return this.#prompts.get(`${agentKey}@${promptVersion}`) ?? null;
  }
}
