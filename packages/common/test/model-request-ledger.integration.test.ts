import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  AgentRuntimeError,
  defineAgent,
  withModelMessage,
} from '../src/agent/index.js';
import { OpenAiCompatibleModelClient } from '../src/models/openai-client.js';
import { SqliteAgentRunStore } from '../src/persistence/agent-run-store.js';
import { SqliteAgentRunCleanup } from '../src/persistence/agent-run-cleanup.js';
import { SqliteModelRequestRepository } from '../src/persistence/model-request-repository.js';
import { SqliteUsageRepository } from '../src/persistence/usage-repository.js';
import { openSqliteDatabase } from '../src/persistence/connection.js';
import { createTemporaryDataRoot } from '../src/testing/index.js';

it.each([true, false])(
  'persists long validation diagnostics without blocking repair, valid=%s',
  async (validRepair) => {
    const root = await createTemporaryDataRoot('long-request-diagnostic-');
    const db = openSqliteDatabase({ dataRoot: root.path });
    try {
      let calls = 0;
      const model = new OpenAiCompatibleModelClient({
        baseUrl: 'https://fixture.test/v1',
        apiKey: 'synthetic',
        model: 'fixture',
        fetchImplementation: () => {
          calls++;
          return Promise.resolve(
            Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ valid: calls === 2 && validRepair }),
                  },
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
          );
        },
      });
      const store = new SqliteAgentRunStore(db.client);
      const runner = new AgentRunner({ store, model, createId: randomUUID });
      const definition = defineAgent({
        key: 'long-diagnostic',
        outputSchemaVersion: '1',
        outputSchemaName: 'Fixture',
        systemPrompt: 'Synthetic diagnostic fixture',
        inputSchema: z.object({}),
        outputSchema: z.object({ valid: z.boolean() }),
        validateOutput: (output) => {
          if (!output.valid)
            throw new AgentRuntimeError('invalid_output', 'safe validation issue '.repeat(30));
        },
        tools: [],
        limits: {
          timeoutMs: 10000,
          maxSteps: 2,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          maxEstimatedCostMicros: 10000,
        },
      });
      const execute = runner.run({ definition, value: {}, signal: new AbortController().signal });
      if (validRepair) expect((await execute).run.status).toBe('succeeded');
      else await expect(execute).rejects.toMatchObject({ category: 'invalid_output' });
      expect(calls).toBe(2);
      const row = db.client.prepare('SELECT id FROM agent_runs').get() as { id: string };
      const requests = new SqliteModelRequestRepository(db.client).listForRun(row.id);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.failureReason?.length).toBe(300);
      expect(store.get(row.id)?.errorCategory).toBe(validRepair ? null : 'invalid_output');
    } finally {
      db.close();
      await root.cleanup();
    }
  },
);

it.each([true, false])(
  'keeps both real HTTP calls in one run during output repair, valid=%s',
  async (validRepair) => {
    const root = await createTemporaryDataRoot('request-output-repair-');
    const db = openSqliteDatabase({ dataRoot: root.path });
    try {
      let sent = 0;
      const model = new OpenAiCompatibleModelClient({
        baseUrl: 'https://fixture.test/v1',
        apiKey: 'synthetic',
        model: 'fixture',
        fetchImplementation: (_url, init) => {
          sent++;
          if (sent === 2) {
            const request = JSON.parse(z.string().parse(init?.body)) as {
              messages: { content: string }[];
            };
            const content = JSON.parse(request.messages[1]?.content ?? '{}') as {
              repair: { validationSummary: string };
            };
            expect(content.repair.validationSummary).toContain('match: unrecognized_keys');
            expect(content.repair.validationSummary).toContain(
              'remove unexpected fields [dimensions]',
            );
            expect(content.repair.validationSummary).not.toContain('sensitive fixture value');
            expect(
              db.client
                .prepare("SELECT count(*) FROM model_requests WHERE state='completed'")
                .pluck()
                .get(),
            ).toBe(1);
          }
          return Promise.resolve(
            Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      match: {
                        score: 80,
                        reasons: ['Synthetic evidence'],
                        ...(sent === 1 || !validRepair
                          ? { dimensions: ['sensitive fixture value'] }
                          : {}),
                      },
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 2 },
            }),
          );
        },
      });
      const store = new SqliteAgentRunStore(db.client);
      const runner = new AgentRunner({ store, model, createId: randomUUID });
      const definition = defineAgent({
        key: 'output-repair-fixture',
        outputSchemaVersion: '1',
        outputSchemaName: 'Match',
        systemPrompt: 'Synthetic schema repair fixture',
        inputSchema: z.object({}),
        outputSchema: z
          .object({
            match: z
              .object({ score: z.number().int().min(0).max(100), reasons: z.array(z.string()) })
              .strict(),
          })
          .strict(),
        tools: [],
        limits: {
          timeoutMs: 10000,
          maxSteps: 2,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
          maxEstimatedCostMicros: 10000,
        },
      });
      const input = {
        definition,
        value: {},
        signal: new AbortController().signal,
        execution: { taskId: 'repair-task', stepKey: 'analysis', resourceKey: 'job' },
      };
      if (validRepair) {
        const result = await runner.runStep(input);
        expect(result.run.status).toBe('succeeded');
        expect((await runner.runStep(input)).run.id).toBe(result.run.id);
      } else {
        await expect(runner.runStep(input)).rejects.toMatchObject({ category: 'invalid_output' });
      }
      const rows = db.client.prepare('SELECT id FROM agent_runs').all() as { id: string }[];
      expect(rows).toHaveLength(1);
      expect(sent).toBe(2);
      const record = store.get(rows[0]?.id ?? 'missing');
      expect(record?.requestIds).toHaveLength(2);
      expect(new Set(record?.requestIds).size).toBe(2);
      expect(record?.billingCalls?.map((call) => call.statusCode)).toEqual([200, 200]);
      expect(record?.billingCalls?.[0]?.failureReason).toContain(
        'remove unexpected fields [dimensions]',
      );
      expect(record?.billingCalls?.[1]?.failureReason).toEqual(
        validRepair ? undefined : expect.stringContaining('match: unrecognized_keys'),
      );
      // 重复记账不含诊断时也不能清除已保存的失败原因。
      const first = record?.billingCalls?.[0];
      if (!first?.requestId) throw new Error('Missing first request');
      const { failureReason: _reason, ...billingOnly } = first;
      void _reason;
      const ledger = new SqliteModelRequestRepository(db.client);
      ledger.save(rows[0]?.id ?? 'missing', {
        id: first.requestId,
        state: 'completed',
        billing: billingOnly,
      });
      expect(ledger.listForRun(rows[0]?.id ?? 'missing')[0]?.failureReason).toContain('dimensions');
      expect(
        new SqliteUsageRepository(db.client)
          .read(0, Date.now() + 1000)
          .calls.find((call) => call.id === first.requestId)?.failureReason,
      ).toContain('dimensions');
      expect(
        db.client
          .prepare("SELECT count(*) FROM events WHERE stream_type='model_request'")
          .pluck()
          .get(),
      ).toBe(validRepair ? 1 : 2);
      expect(record).toMatchObject({ inputTokens: 20, outputTokens: 4 });
      expect(
        db.client
          .prepare("SELECT count(*) FROM model_requests WHERE state='completed'")
          .pluck()
          .get(),
      ).toBe(2);
      expect(record?.errorSummary ?? '').not.toContain('sensitive fixture value');
    } finally {
      db.close();
      await root.cleanup();
    }
  },
);

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
    const input = {
      definition,
      value: {},
      signal: new AbortController().signal,
      execution: { taskId: 'ledger-task', stepKey: 'test', resourceKey: 'one' },
    };
    db.client.exec(
      "INSERT INTO ai_sessions VALUES('conversation','chat','合成对话',1,1); INSERT INTO ai_messages VALUES('reply','conversation','assistant','',1,'pending',1,1);",
    );
    const result = await withModelMessage('reply', () => runner.runStep(input));
    expect(result.run.requestIds).toHaveLength(2);
    expect(db.client.prepare('SELECT ai_message_id FROM model_requests').pluck().all()).toEqual([
      'reply',
      'reply',
    ]);
    db.client.prepare("DELETE FROM ai_sessions WHERE id='conversation'").run();
    expect(db.client.prepare('SELECT ai_message_id FROM model_requests').pluck().all()).toEqual([
      null,
      null,
    ]);
    expect(new Set(result.run.requestIds).size).toBe(2);
    expect(result.run.billingCalls?.map((call) => call.statusCode)).toEqual([400, 200]);
    expect(result.run.billingCalls?.[0]?.failureReason).toContain('HTTP 400');
    expect(result.run.billingCalls?.[1]?.failureReason).toBeUndefined();
    const ledger = new SqliteModelRequestRepository(db.client);
    const call = ledger.listForRun(result.run.id)[1];
    if (!call?.requestId) throw new Error('Missing request ID');
    ledger.save(result.run.id, { id: call.requestId, state: 'completed', billing: call });
    await runner.runStep(input);
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

it('persists zero run cost for a failed request while keeping its per-call cost unknown (AGT-015)', async () => {
  const root = await createTemporaryDataRoot('request-failed-cost-');
  const db = openSqliteDatabase({ dataRoot: root.path });
  try {
    // 1、网关连接被拒：请求未送达且没有上报用量，运行成本按 0 入账。
    const model = new OpenAiCompatibleModelClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'synthetic',
      model: 'fixture',
      fetchImplementation: () =>
        Promise.reject(
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }),
        ),
    });
    const store = new SqliteAgentRunStore(db.client);
    const runner = new AgentRunner({ store, model, createId: randomUUID });
    const definition = defineAgent({
      key: 'failed-cost-fixture',
      outputSchemaVersion: '1',
      outputSchemaName: 'Result',
      systemPrompt: 'Synthetic',
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      tools: [],
      limits: {
        maxSteps: 1,
        timeoutMs: 10000,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        maxEstimatedCostMicros: 10000,
      },
    });
    await expect(
      runner.run({ definition, value: {}, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ category: 'temporary' });
    const persisted = db.client
      .prepare(
        'SELECT status, input_tokens, output_tokens, estimated_cost_micros, pricing_version FROM agent_runs',
      )
      .get();
    expect(persisted).toEqual({
      status: 'failed',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_micros: 0,
      pricing_version: 'unpriced',
    });
    // 2、逐请求明细仍保持未知
    expect(
      db.client.prepare('SELECT total_cost_micros, pricing_version FROM model_requests').all(),
    ).toEqual([{ total_cost_micros: null, pricing_version: 'unpriced' }]);
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
