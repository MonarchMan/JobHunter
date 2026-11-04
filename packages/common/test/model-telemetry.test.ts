import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleModelClient, AnthropicModelClient } from '../src/models/index.js';
import { ModelClientError } from '../src/agent/errors.js';
import { ModelRequestTrace } from '../src/models/request-trace.js';

const request = {
  systemPrompt: 'synthetic',
  input: {},
  outputSchemaName: 'Test',
  outputJsonSchema: { type: 'object' },
  tools: [],
  toolResults: [],
};
const config = {
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'never-persist',
  model: 'synthetic-model',
  inputCostPerMillionUsd: 1,
  outputCostPerMillionUsd: 1,
};
/** SSE 夹具采用受控时钟和跨字节分片，不依赖真实网络或定时等待。 */
function stream(frames: unknown[], clock?: { value: number }, times?: number[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (clock) clock.value = times?.[index] ?? 4000;
          if (index === frames.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frames[index++])}\r\n\r\n`));
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
/** 合成 OpenAI 流先发角色，随后文本和 usage；角色不能抢占首字时间。 */
function openAiFrames(): unknown[] {
  return [
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: '{"ok":' } }] },
    { choices: [{ index: 0, delta: { content: 'true}' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    },
  ];
}

describe('model request telemetry (USG-006)', () => {
  it('does not dispatch or retry when the request-start ledger write fails (USG-009)', async () => {
    let sent = 0;
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: () => {
        sent++;
        return Promise.resolve(stream(openAiFrames()));
      },
    });
    await expect(
      client.complete(request, new AbortController().signal, {
        save() {
          throw new Error('synthetic database failure');
        },
      }),
    ).rejects.toMatchObject({ category: 'configuration', retryable: false });
    expect(sent).toBe(0);
  });
  it('measures effective first content, generation speed and host without leaking credentials', async () => {
    const clock = { value: 1000 };
    const client = new OpenAiCompatibleModelClient({
      ...config,
      now: () => clock.value,
      fetchImplementation: (_url, init) => {
        expect(JSON.parse(z.string().parse(init?.body))).toMatchObject({
          stream: true,
          stream_options: { include_usage: true },
        });
        return Promise.resolve(stream(openAiFrames(), clock, [1200, 1500, 2000, 3000, 3500, 4000]));
      },
    });
    const result = await client.complete(request, new AbortController().signal);
    expect(result).toMatchObject({ kind: 'output', output: { ok: true } });
    expect(result.usage.billingCalls).toHaveLength(1);
    expect(result.usage.billing).toMatchObject({
      application: 'JobHunter',
      provider: 'api.example.test',
      statusCode: 200,
      requestedAt: 1000,
      firstTokenMs: 500,
      durationMs: 3000,
      outputTokensPerSecond: 20,
      inputTokens: 100,
      cacheReadTokens: 80,
    });
    expect(JSON.stringify(result.usage)).not.toContain(config.apiKey);
  });
  it('reassembles streamed tool arguments without changing the tool contract', async () => {
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: () =>
        Promise.resolve(
          stream([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'tool-1', function: { name: 'lookup', arguments: '{"q":' } },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ]),
        ),
    });
    expect(await client.complete(request, new AbortController().signal)).toMatchObject({
      kind: 'tool_calls',
      calls: [{ id: 'tool-1', toolKey: 'lookup', input: { q: 'test' } }],
    });
  });
  it('normalizes Anthropic stream text, cache totals and final usage', async () => {
    const client = new AnthropicModelClient({
      ...config,
      fetchImplementation: () =>
        Promise.resolve(
          stream([
            {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 20,
                  cache_read_input_tokens: 80,
                  cache_creation_input_tokens: 0,
                  output_tokens: 0,
                },
              },
            },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: '{"ok":true}' },
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 10 },
            },
            { type: 'message_stop' },
          ]),
        ),
    });
    expect(await client.complete(request, new AbortController().signal)).toMatchObject({
      kind: 'output',
      output: { ok: true },
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        billing: { statusCode: 200, cacheReadTokens: 80 },
      },
    });
  });
  it('preserves separate format negotiation attempts and keeps nonstream latency unknown', async () => {
    let count = 0;
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: () =>
        Promise.resolve(
          ++count === 1
            ? new Response('unsupported format', { status: 400 })
            : new Response(
                JSON.stringify({
                  choices: [{ message: { content: '{"ok":true}' } }],
                  usage: { prompt_tokens: 1, completion_tokens: 1 },
                }),
              ),
        ),
    });
    const result = await client.complete(request, new AbortController().signal);
    expect(result.usage.billingCalls?.map((call) => call.statusCode)).toEqual([400, 200]);
    expect(result.usage.billing).toMatchObject({ firstTokenMs: null, outputTokensPerSecond: null });
    expect(result.usage.billingCalls?.[0]?.inputTokens).toBeNull();
  });
  it('falls back once when the endpoint explicitly rejects streaming', async () => {
    const bodies: unknown[] = [];
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: (_url, init) => {
        bodies.push(JSON.parse(z.string().parse(init?.body)) as unknown);
        return Promise.resolve(
          bodies.length === 1
            ? new Response('stream_options not supported', { status: 400 })
            : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
        );
      },
    });
    const result = await client.complete(request, new AbortController().signal);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('stream');
    expect(result.usage.billingCalls).toHaveLength(2);
  });
  it.each([401, 429, 500])(
    'retains HTTP %s without persisting the upstream body',
    async (status) => {
      const client = new OpenAiCompatibleModelClient({
        ...config,
        fetchImplementation: () => Promise.resolve(new Response('secret body', { status })),
      });
      try {
        await client.complete(request, new AbortController().signal);
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelClientError);
        expect((error as ModelClientError).usage?.billingCalls?.[0]).toMatchObject({
          statusCode: status,
          provider: 'api.example.test',
        });
        expect(JSON.stringify(error)).not.toContain('secret body');
      }
    },
  );
  it('rejects truncated streams and records a failed 200 response rather than successful output', async () => {
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: () => Promise.resolve(stream(openAiFrames().slice(0, 3))),
    });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({
      category: 'invalid_output',
      usage: { billingCalls: [{ statusCode: 200, transportError: 'invalid_output' }] },
    });
  });
  it('captures network failures and cancellation without inventing an HTTP status', async () => {
    const client = new OpenAiCompatibleModelClient({
      ...config,
      fetchImplementation: () => Promise.reject(new TypeError('network')),
    });
    await expect(client.complete(request, new AbortController().signal)).rejects.toMatchObject({
      category: 'temporary',
      usage: { billingCalls: [{ statusCode: null, transportError: 'network' }] },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client.complete(request, controller.signal)).rejects.toMatchObject({
      category: 'cancelled',
      usage: { billingCalls: [{ statusCode: null, transportError: 'cancelled' }] },
    });
  });
  it('parses split UTF-8 and SSE delimiters and measures Anthropic first content', async () => {
    const clock = { value: 1000 };
    const trace = new ModelRequestTrace({ ...config, costCurrency: 'USD' }, () => clock.value);
    const bytes = new TextEncoder().encode(
      'data: {"type":"message_start","message":{"usage":{}}}\r\n\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"中文"}}\r\n\r\ndata: {"type":"message_stop"}\r\n\r\n',
    );
    let i = 0;
    const response = new Response(
      new ReadableStream(
        {
          pull(c) {
            clock.value++;
            if (i < bytes.length) c.enqueue(bytes.slice(i, (i += 1)));
            else c.close();
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const parsed = await trace.fetch(
      () => Promise.resolve(response),
      config.baseUrl,
      { body: '{}' },
      'anthropic',
    );
    expect(await parsed.json()).toMatchObject({ content: [{ type: 'text', text: '中文' }] });
    expect(trace.usage().billing?.firstTokenMs).toBeGreaterThan(0);
  });
});
