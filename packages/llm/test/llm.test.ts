import { describe, expect, it } from 'vitest';
import { ModelClientError } from '@jobhunter/agent-core';
import {
  AnthropicModelClient,
  createConfiguredModelClient,
  FakeModelClient,
  ModelProviderRegistry,
  OpenAiCompatibleModelClient,
} from '../src/index.js';

const usage = { inputTokens: 1, outputTokens: 1, estimatedCostMicros: 0 };
const request = {
  systemPrompt: 'test',
  input: { value: 1 },
  outputSchemaName: 'Output',
  outputJsonSchema: { type: 'object' },
  maxOutputTokens: 10,
  tools: [],
  toolResults: [],
};

/** 构造测试输入或执行断言的辅助逻辑。 */
function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new TypeError('Expected a JSON request body.');
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('model clients', () => {
  it('runs deterministic queued responses and records requests', async () => {
    const client = new FakeModelClient([{ kind: 'output', output: { ok: true }, usage }]);
    await expect(client.complete(request, new AbortController().signal)).resolves.toMatchObject({
      kind: 'output',
      output: { ok: true },
    });
    expect(client.requests).toEqual([request]);
    expect(client.remainingSteps).toBe(0);
  });

  it('maps configured fake errors without hiding their category', async () => {
    const client = new FakeModelClient([new ModelClientError('rate_limited', 'Limited.', true)]);
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({
      category: 'rate_limited',
      retryable: true,
    });
  });

  it('registers model factories without requiring a provider at startup', () => {
    const registry = new ModelProviderRegistry();
    expect(registry.has('fake')).toBe(false);
    registry.register('fake', () => new FakeModelClient([]));
    expect(registry.create('fake', {}).metadata.provider).toBe('fake');
    expect(() => {
      registry.register('fake', () => new FakeModelClient([]));
    }).toThrow(/Duplicate/);
  });
});

describe('Anthropic model client', () => {
  it('maps Messages structured output and uses Anthropic authentication', async () => {
    let body: Record<string, unknown> | undefined;
    const client = new AnthropicModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-secret',
      model: 'claude-test',
      fetchImplementation: (input, init) => {
        expect(requestUrl(input)).toBe('https://api.anthropic.com/v1/messages');
        expect(init?.headers).toMatchObject({
          'x-api-key': 'anthropic-secret',
          'anthropic-version': '2023-06-01',
        });
        body = requestBody(init);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: 'text', text: '{"ok":true}' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 3, output_tokens: 2 },
            }),
            { status: 200 },
          ),
        );
      },
    });

    await expect(client.complete(request, new AbortController().signal)).resolves.toEqual({
      kind: 'output',
      output: { ok: true },
      usage: { inputTokens: 3, outputTokens: 2, estimatedCostMicros: 0 },
    });
    expect(body).toMatchObject({
      model: 'claude-test',
      system: 'test',
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
    expect(JSON.stringify(client.metadata)).not.toContain('anthropic-secret');
  });

  it('maps Anthropic tool_use blocks to model tool calls', async () => {
    const client = new AnthropicModelClient({
      baseUrl: 'https://gateway.example.test/anthropic/',
      apiKey: 'anthropic-secret',
      model: 'claude-test',
      fetchImplementation: (input, init) => {
        expect(requestUrl(input)).toBe('https://gateway.example.test/anthropic/v1/messages');
        expect(requestBody(init)).toMatchObject({
          tools: [
            { name: 'lookup', description: 'Look up data', input_schema: { type: 'object' } },
          ],
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: [{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: { id: 7 } }],
              stop_reason: 'tool_use',
              usage: { input_tokens: 4, output_tokens: 1 },
            }),
            { status: 200 },
          ),
        );
      },
    });

    await expect(
      client.complete(
        { ...request, tools: [{ key: 'lookup', description: 'Look up data' }] },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: 'tool_calls',
      calls: [{ id: 'tool-1', toolKey: 'lookup', input: { id: 7 } }],
    });
  });

  it('retries without structured output when an Anthropic-compatible gateway rejects it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new AnthropicModelClient({
      baseUrl: 'https://gateway.example.test',
      apiKey: 'anthropic-secret',
      model: 'claude-test',
      fetchImplementation: (_input, init) => {
        bodies.push(requestBody(init));
        return Promise.resolve(
          bodies.length === 1
            ? new Response('{}', { status: 400 })
            : new Response(
                JSON.stringify({
                  content: [{ type: 'text', text: '{"ok":true}' }],
                  stop_reason: 'end_turn',
                  usage: { input_tokens: 1, output_tokens: 1 },
                }),
                { status: 200 },
              ),
        );
      },
    });

    await expect(client.complete(request, new AbortController().signal)).resolves.toMatchObject({
      kind: 'output',
      output: { ok: true },
    });
    expect(bodies[0]).toHaveProperty('output_config');
    expect(bodies[1]).not.toHaveProperty('output_config');
  });

  it('classifies Anthropic refusals and rate limits', async () => {
    const create = (response: Response): AnthropicModelClient =>
      new AnthropicModelClient({
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-secret',
        model: 'claude-test',
        fetchImplementation: () => Promise.resolve(response),
      });
    await expect(
      create(new Response('upstream secret', { status: 429 })).complete(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ category: 'rate_limited', retryable: true });
    await expect(
      create(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'refused' }],
            stop_reason: 'refusal',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        ),
      ).complete(request, new AbortController().signal),
    ).rejects.toMatchObject({ category: 'content_rejected', retryable: false });
  });

  it('creates the configured provider without changing OpenAI compatibility', () => {
    expect(
      createConfiguredModelClient({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'secret',
        model: 'claude-test',
      }).metadata.provider,
    ).toBe('anthropic');
    expect(
      createConfiguredModelClient({
        provider: 'openai-compatible',
        baseUrl: 'https://models.example.test/v1',
        apiKey: 'secret',
        model: 'test-model',
      }).metadata.provider,
    ).toBe('openai-compatible');
  });
});

describe('OpenAI-compatible model client', () => {
  it('maps a structured Chat Completions response without exposing its API key', async () => {
    const fetchImplementation: typeof fetch = (input, init): Promise<Response> => {
      const target = input instanceof Request ? input.url : input.toString();
      expect(target).toBe('https://models.example.test/v1/chat/completions');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer test-secret' });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const client = new OpenAiCompatibleModelClient({
      baseUrl: 'https://models.example.test/v1/',
      apiKey: 'test-secret',
      model: 'test-model',
      fetchImplementation,
    });

    await expect(client.complete(request, new AbortController().signal)).resolves.toEqual({
      kind: 'output',
      output: { ok: true },
      usage: { inputTokens: 3, outputTokens: 2, estimatedCostMicros: 0 },
    });
    expect(JSON.stringify(client.metadata)).not.toContain('test-secret');
  });

  it('disables DeepSeek v4 reasoning so structured extraction can finish promptly', async () => {
    let body: Record<string, unknown> | undefined;
    const client = new OpenAiCompatibleModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-secret',
      model: 'deepseek-v4-flash',
      fetchImplementation: (_input, init) => {
        body = requestBody(init);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
            }),
            { status: 200 },
          ),
        );
      },
    });

    await client.complete(request, new AbortController().signal);
    expect(body?.thinking).toEqual({ type: 'disabled' });
    expect(body?.response_format).toEqual({ type: 'json_object' });
  });

  it('normalizes a whole-response JSON code fence without weakening schema validation', async () => {
    const client = new OpenAiCompatibleModelClient({
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'test-secret',
      model: 'test-model',
      fetchImplementation: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                { finish_reason: 'stop', message: { content: '```json\n{"ok":true}\n```' } },
              ],
            }),
            { status: 200 },
          ),
        ),
    });

    await expect(client.complete(request, new AbortController().signal)).resolves.toMatchObject({
      kind: 'output',
      output: { ok: true },
    });
  });

  it.each(['plain text', ''])(
    'returns unparsed output for one Runner repair: %j',
    async (content) => {
      const client = new OpenAiCompatibleModelClient({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'test-secret',
        model: 'deepseek-v4-flash',
        fetchImplementation: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
              { status: 200 },
            ),
          ),
      });

      await expect(client.complete(request, new AbortController().signal)).resolves.toEqual({
        kind: 'unparsed_output',
        text: content,
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 },
      });
    },
  );

  it('classifies authentication and rate-limit responses safely', async () => {
    const create = (status: number): OpenAiCompatibleModelClient =>
      new OpenAiCompatibleModelClient({
        baseUrl: 'https://models.example.test/v1',
        apiKey: 'test-secret',
        model: 'test-model',
        fetchImplementation: () =>
          Promise.resolve(new Response('secret upstream body', { status })),
      });
    await expect(create(401).complete(request, new AbortController().signal)).rejects.toMatchObject(
      {
        category: 'invalid_auth',
        retryable: false,
      },
    );
    await expect(create(429).complete(request, new AbortController().signal)).rejects.toMatchObject(
      {
        category: 'rate_limited',
        retryable: true,
      },
    );
  });
});
