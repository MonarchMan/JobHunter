import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentRunner, defineAgent, type ModelClient } from '../src/agent/index.js';
import { OpenAiCompatibleModelClient } from '../src/models/openai-client.js';
import { AnthropicModelClient } from '../src/models/anthropic-client.js';
import { openSqliteDatabase } from '../src/persistence/connection.js';
import { SqliteAgentRunStore } from '../src/persistence/agent-run-store.js';
import { SqliteModelRequestRepository } from '../src/persistence/model-request-repository.js';
import { createTemporaryDataRoot } from '../src/testing/index.js';

const definition = defineAgent({
  key: 'stream-accounting-fixture',
  outputSchemaName: 'Result',
  outputSchemaVersion: '1',
  systemPrompt: 'Synthetic stream fixture',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  tools: [],
  limits: {
    maxSteps: 2,
    timeoutMs: 10000,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxEstimatedCostMicros: 10000,
  },
});

for (const protocol of ['openai', 'anthropic'] as const) {
  it.each([
    'cancel',
    'timeout',
    'network',
    'eof',
    'malformed',
    'success',
    'zero',
    'no-usage',
  ] as const)(
    `${protocol} preserves observed usage and request identity on %s`,
    async (outcome) => {
      const root = await createTemporaryDataRoot('stream-accounting-');
      const db = openSqliteDatabase({ dataRoot: root.path });
      const abort = new AbortController();
      const streamState: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamState.controller = controller;
        },
      });
      const controller = streamState.controller;
      if (!controller) throw new Error('Stream controller missing');
      const send = (value: unknown): void => {
        controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n'));
      };
      try {
        const config = {
          baseUrl: 'https://fixture.test',
          apiKey: 'synthetic-secret',
          model: 'fixture',
          inputCostPerMillionUsd: 1,
          outputCostPerMillionUsd: 2,
          cacheReadPrice: 0.1,
          cacheWritePrice: 0,
          cacheWrite1hPrice: 0,
          ...(outcome === 'timeout' ? { timeoutMs: 1000 } : {}),
          fetchImplementation: vi.fn<typeof fetch>((_url, init) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                controller.error(new DOMException('cancelled', 'AbortError'));
              },
              { once: true },
            );
            return Promise.resolve(
              new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
            );
          }),
        };
        const model: ModelClient =
          protocol === 'openai'
            ? new OpenAiCompatibleModelClient(config)
            : new AnthropicModelClient(config);
        const store = new SqliteAgentRunStore(db.client);
        const runner = new AgentRunner({ model, store, createId: randomUUID });
        const result = runner.run({ definition, value: {}, signal: abort.signal }).then(
          () => null,
          (error: unknown) => error,
        );
        if (outcome !== 'no-usage') {
          send(
            protocol === 'openai'
              ? {
                  choices: [{ delta: { content: '{"ok":true}' } }],
                  usage: {
                    prompt_tokens: 100,
                    prompt_tokens_details: { cached_tokens: 40 },
                    cache_creation_input_tokens: 0,
                  },
                }
              : {
                  type: 'message_start',
                  message: {
                    usage: {
                      input_tokens: 60,
                      cache_read_input_tokens: 40,
                      cache_creation_input_tokens: 0,
                    },
                  },
                },
          );
        } else {
          send(
            protocol === 'openai'
              ? { choices: [{ delta: { content: 'partial' } }] }
              : { type: 'message_start', message: {} },
          );
        }
        const read = (): ReturnType<SqliteModelRequestRepository['listForRun']> => {
          const run = db.client.prepare('SELECT id FROM agent_runs').get() as
            { id: string } | undefined;
          return new SqliteModelRequestRepository(db.client).listForRun(run?.id ?? 'missing');
        };
        await vi.waitFor(() => {
          expect(read()).toHaveLength(1);
          if (outcome !== 'no-usage') expect(read()[0]?.inputTokens).toBe(100);
        });
        const originalId = read()[0]?.requestId;
        expect(db.client.prepare('SELECT state FROM model_requests').pluck().get()).toBe('running');
        const succeeds = outcome === 'success' || outcome === 'zero';
        const outputTokens = outcome === 'zero' ? 0 : 20;
        if (succeeds) {
          if (protocol === 'openai') {
            // 重复输入是累计快照，空缓存字段不能抹掉已知命中数。
            send({
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: outputTokens,
                prompt_tokens_details: { cached_tokens: null },
              },
            });
          } else {
            send({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '{"ok":true}' },
            });
            send({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: outputTokens, cache_read_input_tokens: null },
            });
            send({ type: 'message_stop' });
          }
          controller.close();
        } else if (outcome === 'cancel' || outcome === 'no-usage') abort.abort();
        else if (outcome === 'network') controller.error(new TypeError('private transport detail'));
        else if (outcome === 'eof') controller.close();
        else if (outcome !== 'timeout') {
          controller.enqueue(new TextEncoder().encode('data: invalid-json\n\n'));
          controller.close();
        }

        const error = await result;
        if (succeeds) expect(error).toBeNull();
        else
          expect(error).toMatchObject({
            category:
              outcome === 'cancel' || outcome === 'no-usage'
                ? 'cancelled'
                : outcome === 'timeout'
                  ? 'timeout'
                  : outcome === 'network'
                    ? 'temporary'
                    : 'invalid_output',
          });
        expect(config.fetchImplementation).toHaveBeenCalledTimes(1);
        expect(read()).toHaveLength(1);
        expect(read()[0]?.requestId).toBe(originalId);
        expect(db.client.prepare('SELECT state FROM model_requests').pluck().get()).toBe(
          'completed',
        );
        expect(read()[0]).toMatchObject({
          statusCode: 200,
          inputTokens: outcome === 'no-usage' ? null : 100,
          uncachedInputTokens: outcome === 'no-usage' ? null : 60,
          cacheReadTokens: outcome === 'no-usage' ? null : 40,
          cacheWriteTokens: outcome === 'no-usage' ? null : 0,
          outputTokens: succeeds ? outputTokens : null,
          totalCostMicros: succeeds ? 64 + outputTokens * 2 : null,
          transportError: succeeds
            ? null
            : outcome === 'cancel' || outcome === 'no-usage'
              ? 'cancelled'
              : outcome === 'timeout'
                ? 'timeout'
                : outcome === 'network'
                  ? 'network'
                  : 'invalid_output',
        });
        expect(read()[0]?.inputCostMicros).toBe(outcome === 'no-usage' ? null : 60);
        expect(db.client.prepare('SELECT status FROM agent_runs').pluck().get()).toBe(
          succeeds
            ? 'succeeded'
            : outcome === 'cancel' || outcome === 'no-usage'
              ? 'cancelled'
              : 'failed',
        );
      } finally {
        abort.abort();
        db.close();
        await root.cleanup();
      }
    },
  );

  it(`${protocol} exposes snapshot persistence failures instead of continuing silently`, async () => {
    const usage =
      protocol === 'openai'
        ? { choices: [], usage: { prompt_tokens: 1 } }
        : { type: 'message_start', message: { usage: { input_tokens: 1 } } };
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response('data: ' + JSON.stringify(usage) + '\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    );
    const config = {
      baseUrl: 'https://fixture.test',
      apiKey: 'synthetic',
      model: 'fixture',
      fetchImplementation,
    };
    const client =
      protocol === 'openai'
        ? new OpenAiCompatibleModelClient(config)
        : new AnthropicModelClient(config);
    await expect(
      client.complete(
        {
          systemPrompt: 'fixture',
          input: {},
          outputSchemaName: 'Result',
          outputJsonSchema: {},
          tools: [],
          toolResults: [],
        },
        new AbortController().signal,
        {
          save(record) {
            if (record.billing.inputTokens !== null) throw new Error('synthetic write failure');
          },
        },
      ),
    ).rejects.toMatchObject({ name: 'ModelRequestPersistenceError', category: 'configuration' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
}
