import { describe, expect, it } from 'vitest';
import { ModelClientError } from '@jobhunter/agent-core';
import {
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
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
  });

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
