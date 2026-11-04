import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { AgentRunner, defineAgent } from '../src/agent/index.js';
import { OpenAiCompatibleModelClient } from '../src/models/openai-compatible-client.js';
import { SqliteAgentRunStore } from '../src/persistence/agent-run-store.js';
import { SqliteAgentRunCleanup } from '../src/persistence/agent-run-cleanup.js';
import { SqliteModelRequestRepository } from '../src/persistence/model-request-repository.js';
import { SqliteUsageRepository } from '../src/persistence/usage-repository.js';
import { openSqliteDatabase } from '../src/persistence/connection.js';
import { createTemporaryDataRoot } from '../src/testing/index.js';

/** 工具执行时检查已完成请求可见，避免仅运行结束后落库的实现误通过。 */
it('persists each negotiation attempt before the next HTTP and retains the ledger after run cleanup (USG-009, USG-010)', async () => {
  const root = await createTemporaryDataRoot('request-ledger-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    let sent = 0;
    const now = Date.parse('2026-11-04T12:00:00Z');
    const model = new OpenAiCompatibleModelClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'synthetic',
      model: 'fixture',
      now: () => now,
      fetchImplementation: () => {
        sent++;
        const records = db.client
          .prepare('SELECT id, state, status_code FROM model_requests ORDER BY rowid')
          .all();
        if (sent === 1) expect(records).toMatchObject([{ state: 'running', status_code: null }]);
        else {
          expect(records).toMatchObject([
            { state: 'completed', status_code: 400 },
            { state: 'running', status_code: null },
          ]);
          expect(db.client.prepare('SELECT status FROM agent_runs').pluck().get()).toBe('running');
        }
        return Promise.resolve(
          sent === 1
            ? new Response('unsupported response_format', { status: 400 })
            : new Response(
                JSON.stringify({
                  choices: [{ message: { content: '{"ok":true}' } }],
                  usage: { prompt_tokens: 10, completion_tokens: 2 },
                }),
              ),
        );
      },
    });
    const store = new SqliteAgentRunStore(db.client);
    const runner = new AgentRunner({ store, model, createId: randomUUID, now: () => now });
    const definition = defineAgent({
      key: 'ledger-fixture',
      outputSchemaVersion: '1',
      outputSchemaName: 'Result',
      systemPrompt: 'Synthetic',
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
    const input = { definition, value: {}, signal: new AbortController().signal };
    const result = await runner.run(input);
    expect(result.run.requestIds).toHaveLength(2);
    expect(new Set(result.run.requestIds).size).toBe(2);
    expect(result.run.billingCalls?.map((call) => call.statusCode)).toEqual([400, 200]);
    const ledger = new SqliteModelRequestRepository(db.client);
    const call = ledger.listForRun(result.run.id)[1];
    if (!call?.requestId) throw new Error('Missing request ID');
    ledger.save(result.run.id, { id: call.requestId, state: 'completed', billing: call });
    await runner.run(input);
    expect(sent).toBe(2);
    const usage = new SqliteUsageRepository(db.client);
    const before = usage.read(0, now + 1).calls;
    expect(before).toHaveLength(2);
    new SqliteAgentRunCleanup(db.client).prune(result.run.id, false);
    expect(store.get(result.run.id)).toBeNull();
    expect(db.client.prepare('SELECT agent_run_id FROM model_requests').all()).toEqual([
      { agent_run_id: null },
      { agent_run_id: null },
    ]);
    expect(usage.read(0, now + 1).calls).toEqual(
      before.map((call) => ({ ...call, status: 'deleted' })),
    );
    expect(db.client.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const plan = db.client
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM model_requests WHERE requested_at >= ? AND requested_at < ?',
      )
      .all(0, now + 1);
    expect(JSON.stringify(plan)).toContain('model_requests_time_idx');
  } finally {
    db.close();
    await root.cleanup();
  }
});

it('retains an interrupted request start without inventing final usage (USG-009)', async () => {
  const root = await createTemporaryDataRoot('request-interrupted-');
  let db = openSqliteDatabase({ dataRoot: root.path });
  try {
    db.client.exec(
      `INSERT INTO agent_runs (id,agent_key,definition_hash,model_config_hash,input_hash,cache_key,status,started_at) VALUES ('run','fixture','definition','m','i','c','running',1)`,
    );
    const ledger = new SqliteModelRequestRepository(db.client);
    const billing = {
      requestId: 'request',
      model: 'fixture',
      requestedAt: 1,
      inputTokens: null,
      outputTokens: null,
      uncachedInputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      inputCostMicros: null,
      outputCostMicros: null,
      cacheReadCostMicros: null,
      cacheWriteCostMicros: null,
      totalCostMicros: null,
      currency: 'USD' as const,
      pricingVersion: 'unpriced',
      period: 'unknown' as const,
      precision: 'unpriced' as const,
      rates: null,
    };
    ledger.save('run', { id: 'request', state: 'running', billing });
    db.close();
    db = openSqliteDatabase({ dataRoot: root.path });
    expect(new SqliteUsageRepository(db.client).read(0, 2).calls).toMatchObject([
      {
        id: 'request',
        requestState: 'running',
        statusCode: null,
        inputTokens: null,
        totalCostMicros: null,
        durationMs: null,
      },
    ]);
  } finally {
    db.close();
    await root.cleanup();
  }
});
