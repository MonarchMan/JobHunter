import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { AgentRunner, defineAgent } from '../src/agent/index.js';
import { OpenAiCompatibleModelClient } from '../src/models/openai-compatible-client.js';
import { SqliteAgentRunStore } from '../src/persistence/agent-run-store.js';
import { SqliteUsageRepository } from '../src/persistence/usage-repository.js';
import { UsageService } from '../src/usage/service.js';
import { openSqliteDatabase } from '../src/persistence/connection.js';
import { createTemporaryDataRoot } from '../src/testing/index.js';

it('persists failed HTTP attempts, retries once and filters HTTP status independently of the final run (USG-006)', async () => {
  const root = await createTemporaryDataRoot('usage-trace-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    let calls = 0;
    const now = Date.parse('2026-11-04T12:00:00Z');
    const client = new OpenAiCompatibleModelClient({
      baseUrl: 'https://api.example.test',
      apiKey: 'synthetic-secret',
      model: 'fixture',
      now: () => now,
      fetchImplementation: () =>
        Promise.resolve(
          ++calls === 1
            ? new Response('rate limited', { status: 429 })
            : new Response(
                JSON.stringify({
                  choices: [{ message: { content: '{"ok":true}' } }],
                  usage: { prompt_tokens: 10, completion_tokens: 2 },
                }),
              ),
        ),
    });
    const store = new SqliteAgentRunStore(db.client);
    const runner = new AgentRunner({ store, model: client, now: () => now, createId: randomUUID });
    const definition = defineAgent({
      key: 'usage-fixture',
      version: '1.0.0',
      promptVersion: '1',
      outputSchemaVersion: '1',
      outputSchemaName: 'Result',
      systemPrompt: 'Synthetic only',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [],
      limits: {
        maxSteps: 2,
        timeoutMs: 10000,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        maxEstimatedCostMicros: 1000,
      },
    });
    const input = {
      definition,
      value: {},
      signal: new AbortController().signal,
      retryKey: 'synthetic-task',
    };
    await expect(runner.run(input)).rejects.toMatchObject({ category: 'rate_limited' });
    const service = new UsageService(new SqliteUsageRepository(db.client));
    expect(service.query({}, now).calls[0]).toMatchObject({
      statusCode: 429,
      status: 'failed',
      provider: 'api.example.test',
      application: 'JobHunter',
    });
    const success = await runner.run(input);
    expect(success.run.billingCalls?.map((call) => call.statusCode)).toEqual([429, 200]);
    expect(success.run.inputTokens).toBe(10);
    expect(service.query({ statusCode: '429' }, now)).toMatchObject({
      total: { requests: 1 },
      calls: [{ statusCode: 429, status: 'succeeded' }],
    });
    expect(
      service.query({ provider: 'api.example.test', statusCode: '200' }, now).total.requests,
    ).toBe(1);
    expect(service.query({ statusCode: 'unknown' }, now).total.requests).toBe(0);
    await runner.run(input);
    expect(calls).toBe(2);
    expect(service.query({}, now).total.requests).toBe(2);
    expect(JSON.stringify(service.query({}, now))).not.toContain('synthetic-secret');
  } finally {
    db.close();
    await root.cleanup();
  }
});
