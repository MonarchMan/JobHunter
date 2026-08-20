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
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                function: z.object({ name: z.string().min(1), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().default(0),
      completion_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
});

export interface OpenAiCompatibleClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

function endpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/u, '');
  if (path.endsWith('/chat/completions')) return url.toString();
  url.pathname = `${path || '/v1'}/chat/completions`;
  return url.toString();
}

function usage(value: z.infer<typeof responseSchema>['usage']): ModelUsage {
  return {
    inputTokens: value?.prompt_tokens ?? 0,
    outputTokens: value?.completion_tokens ?? 0,
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
      .object({
        error: z.object({
          code: z.union([z.string(), z.number()]).optional(),
          param: z.string().optional(),
        }),
      })
      .safeParse(await response.json());
    if (body.success) {
      const code = body.data.error.code;
      const param = body.data.error.param;
      const safeCode = code === undefined ? '' : String(code).replaceAll(/[^a-zA-Z0-9_.-]/g, '');
      const safeParam = param?.replaceAll(/[^a-zA-Z0-9_.-]/g, '') ?? '';
      detail = [safeCode && `code=${safeCode}`, safeParam && `param=${safeParam}`]
        .filter(Boolean)
        .join(',');
    }
  } catch {
    // Upstream error bodies are optional and never included verbatim.
  }
  return new ModelClientError(
    'invalid_request',
    `Model provider rejected the request (${String(status)}${detail ? `; ${detail}` : ''}).`,
  );
}

/** OpenAI-compatible Chat Completions adapter. Provider DTOs stay inside this boundary. */
export class OpenAiCompatibleModelClient implements ModelClient {
  readonly #config: z.infer<typeof configSchema>;
  readonly #fetch: typeof fetch;

  public readonly metadata: ModelClient['metadata'];

  public constructor(input: OpenAiCompatibleClientConfig) {
    this.#config = configSchema.parse({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    this.#fetch = input.fetchImplementation ?? fetch;
    this.metadata = {
      provider: 'openai-compatible',
      model: this.#config.model,
      config: { baseUrl: this.#config.baseUrl, timeoutMs: this.#config.timeoutMs },
      costCurrency: 'USD',
      pricingVersion: 'unpriced-v1',
    };
  }

  public async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const timeout = AbortSignal.timeout(this.#config.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const messages = [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          input: request.input,
          outputContract: {
            name: request.outputSchemaName,
            jsonSchema: request.outputJsonSchema,
          },
          ...(request.toolResults.length === 0 ? {} : { toolResults: request.toolResults }),
          ...(request.repair ? { repair: request.repair } : {}),
        }),
      },
    ];
    try {
      const baseBody = {
        model: this.#config.model,
        messages,
        max_tokens: request.maxOutputTokens,
        ...(request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.key,
                  description: tool.description,
                  parameters: { type: 'object', additionalProperties: true },
                },
              })),
            }),
      };
      const dispatch = (responseFormat?: unknown): Promise<Response> =>
        this.#fetch(endpoint(this.#config.baseUrl), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.#config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...baseBody,
            ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
          }),
          signal: combined,
        });
      let response = await dispatch({
        type: 'json_schema',
        json_schema: {
          name: request.outputSchemaName,
          strict: true,
          schema: request.outputJsonSchema,
        },
      });
      // Compatibility gateways commonly implement JSON mode before full json_schema mode.
      if (response.status === 400) response = await dispatch({ type: 'json_object' });
      if (response.status === 400) response = await dispatch();
      if (!response.ok) throw await responseError(response);
      const parsed = responseSchema.parse(await response.json());
      const choice = parsed.choices[0];
      if (!choice) throw new ModelClientError('invalid_output', 'Model response had no choice.');
      if (choice.finish_reason === 'content_filter')
        throw new ModelClientError('content_rejected', 'Model provider rejected the content.');
      const calls = choice.message.tool_calls;
      if (calls && calls.length > 0) {
        return {
          kind: 'tool_calls',
          calls: calls.map((call) => {
            try {
              return {
                id: call.id,
                toolKey: call.function.name,
                input: JSON.parse(call.function.arguments) as unknown,
              };
            } catch {
              throw new ModelClientError('invalid_output', 'Model tool arguments were not JSON.');
            }
          }),
          usage: usage(parsed.usage),
        };
      }
      if (!choice.message.content)
        throw new ModelClientError('invalid_output', 'Model response content was empty.');
      let output: unknown;
      try {
        output = JSON.parse(choice.message.content) as unknown;
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

export function registerOpenAiCompatibleProvider(registry: {
  register(
    provider: string,
    factory: (config: Readonly<Record<string, unknown>>) => ModelClient,
  ): void;
}): void {
  registry.register(
    'openai-compatible',
    (value) => new OpenAiCompatibleModelClient(configSchema.parse(value)),
  );
}
