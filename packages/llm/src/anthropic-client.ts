import {
  ModelClientError,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
} from '@jobhunter/agent-core';
import { z } from 'zod';

const configSchema = z
  .object({
    baseUrl: z
      .string()
      .trim()
      .min(1)
      .refine((value) => {
        try {
          return ['http:', 'https:'].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, 'Base URL must be an HTTP(S) URL.'),
    apiKey: z.string().trim().min(1),
    model: z.string().trim().min(1),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(10 * 60_000)
      .default(60_000),
  })
  .strict();

const responseSchema = z.object({
  content: z.array(z.looseObject({ type: z.string() })),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      cache_creation_input_tokens: z.number().int().nonnegative().optional(),
      cache_read_input_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() });
const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});

export interface AnthropicClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/u, '');
  if (path.endsWith('/messages')) return url.toString();
  url.pathname = path.endsWith('/v1')
    ? `${path}/messages`
    : `${path}/v1/messages`.replace(/^\/+/u, '/');
  return url.toString();
}

function usage(value: z.infer<typeof responseSchema>['usage']): ModelUsage {
  return {
    inputTokens:
      (value?.input_tokens ?? 0) +
      (value?.cache_creation_input_tokens ?? 0) +
      (value?.cache_read_input_tokens ?? 0),
    outputTokens: value?.output_tokens ?? 0,
    estimatedCostMicros: 0,
  };
}

async function responseError(response: Response): Promise<ModelClientError> {
  const status = response.status;
  if (status === 401 || status === 403)
    return new ModelClientError('invalid_auth', 'Model provider rejected authentication.');
  if (status === 429)
    return new ModelClientError('rate_limited', 'Model provider rate limited the request.', true);
  if (status >= 500)
    return new ModelClientError('temporary', 'Model provider is temporarily unavailable.', true);
  let detail = '';
  try {
    const body = z
      .object({ error: z.object({ type: z.string().optional() }) })
      .safeParse(await response.json());
    if (body.success) {
      const safeType = body.data.error.type?.replaceAll(/[^a-zA-Z0-9_.-]/g, '') ?? '';
      detail = safeType ? `; type=${safeType}` : '';
    }
  } catch {
    // Upstream error bodies are optional and never included verbatim.
  }
  return new ModelClientError(
    'invalid_request',
    `Model provider rejected the request (${String(status)}${detail}).`,
  );
}

/** Anthropic Messages adapter. Provider DTOs stay inside this boundary. */
export class AnthropicModelClient implements ModelClient {
  readonly #config: z.infer<typeof configSchema>;
  readonly #fetch: typeof fetch;

  public readonly metadata: ModelClient['metadata'];

  public constructor(input: AnthropicClientConfig) {
    this.#config = configSchema.parse({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    this.#fetch = input.fetchImplementation ?? fetch;
    this.metadata = {
      provider: 'anthropic',
      model: this.#config.model,
      config: { baseUrl: this.#config.baseUrl, timeoutMs: this.#config.timeoutMs },
      costCurrency: 'USD',
      pricingVersion: 'unpriced-v1',
    };
  }

  public async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const timeout = AbortSignal.timeout(this.#config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const baseBody = {
      model: this.#config.model,
      max_tokens: request.maxOutputTokens,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            input: request.input,
            outputContract: {
              name: request.outputSchemaName,
              jsonSchema: request.outputJsonSchema,
              instruction: 'Return only the JSON value that satisfies this schema.',
            },
            ...(request.toolResults.length === 0 ? {} : { toolResults: request.toolResults }),
            ...(request.repair ? { repair: request.repair } : {}),
          }),
        },
      ],
      ...(request.tools.length === 0
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              name: tool.key,
              description: tool.description,
              input_schema: { type: 'object', additionalProperties: true },
            })),
          }),
    };
    const dispatch = (structured: boolean): Promise<Response> =>
      this.#fetch(endpoint(this.#config.baseUrl), {
        method: 'POST',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': this.#config.apiKey,
        },
        body: JSON.stringify({
          ...baseBody,
          ...(structured
            ? {
                output_config: {
                  format: { type: 'json_schema', schema: request.outputJsonSchema },
                },
              }
            : {}),
        }),
        signal: combined,
      });

    try {
      let response = await dispatch(true);
      if (response.status === 400) response = await dispatch(false);
      if (!response.ok) throw await responseError(response);
      const parsed = responseSchema.parse(await response.json());
      if (parsed.stop_reason === 'refusal')
        throw new ModelClientError('content_rejected', 'Model provider rejected the content.');

      const calls = parsed.content.flatMap((block) => {
        const call = toolUseBlockSchema.safeParse(block);
        return call.success
          ? [{ id: call.data.id, toolKey: call.data.name, input: call.data.input }]
          : [];
      });
      if (calls.length > 0) return { kind: 'tool_calls', calls, usage: usage(parsed.usage) };

      const content = parsed.content.flatMap((block) => {
        const text = textBlockSchema.safeParse(block);
        return text.success ? [text.data.text] : [];
      });
      if (content.length === 0)
        throw new ModelClientError('invalid_output', 'Model response content was empty.');
      let output: unknown;
      try {
        output = JSON.parse(content.join('')) as unknown;
      } catch {
        throw new ModelClientError('invalid_output', 'Model response content was not JSON.');
      }
      return { kind: 'output', output, usage: usage(parsed.usage) };
    } catch (error) {
      if (error instanceof ModelClientError) throw error;
      if (combined.aborted) {
        if (signal.aborted) throw new ModelClientError('cancelled', 'Model request was cancelled.');
        throw new ModelClientError('timeout', 'Model request timed out.', true);
      }
      if (error instanceof z.ZodError)
        throw new ModelClientError(
          'invalid_output',
          'Model provider returned an invalid response.',
        );
      throw new ModelClientError('temporary', 'Model provider request failed.', true);
    }
  }
}

export function registerAnthropicProvider(registry: {
  register(
    provider: string,
    factory: (config: Readonly<Record<string, unknown>>) => ModelClient,
  ): void;
}): void {
  registry.register('anthropic', (value) => new AnthropicModelClient(configSchema.parse(value)));
}
