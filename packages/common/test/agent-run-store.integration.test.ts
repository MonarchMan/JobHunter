import type { AgentRunRecord, AgentRunUsage } from '@jobhunter/common/agent';
import { createTemporaryDataRoot } from '@jobhunter/common/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  type SqliteDatabaseHandle,
} from '@jobhunter/common/persistence/connection';
import { SqliteAgentRunStore } from '@jobhunter/common/persistence/agent-runs';
import { calculateBilling } from '../src/models/billing.js';

const resources: {
  readonly root: Awaited<ReturnType<typeof createTemporaryDataRoot>>;
  readonly handle: SqliteDatabaseHandle;
}[] = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.handle.close();
    await resource.root.cleanup();
  }
});

/** 构造测试输入或执行断言的辅助逻辑。 */
async function setup(): Promise<{
  readonly handle: SqliteDatabaseHandle;
  readonly store: SqliteAgentRunStore;
}> {
  const root = await createTemporaryDataRoot('jobhunter-agent-run-');
  const handle = openSqliteDatabase({ dataRoot: root.path });
  resources.push({ root, handle });
  return { handle, store: new SqliteAgentRunStore(handle.client) };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function running(id: string, cacheKey = 'cache-key'): AgentRunRecord {
  return {
    id,
    agentKey: 'resume-profile',
    agentVersion: '1.0.0',
    promptVersion: 'prompt-v1',
    modelConfigHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    cacheKey,
    status: 'running',
    output: null,
    outputHash: null,
    errorCategory: null,
    errorSummary: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCostMicros: null,
    costCurrency: 'USD',
    pricingVersion: 'test-v1',
    startedAt: 1,
    finishedAt: null,
  };
}

const usage: AgentRunUsage = {
  inputTokens: 10,
  outputTokens: 5,
  estimatedCostMicros: 12,
  costCurrency: 'USD',
  pricingVersion: 'test-v1',
};

describe('SQLite agent run store', () => {
  it('restarts the original row and appends tool events after previous attempts', async () => {
    const { store, handle } = await setup();
    store.createRunning(running('retry'));
    store.saveToolCall({
      id: 'tool-1',
      agentRunId: 'retry',
      sequenceNo: 0,
      toolKey: 'test',
      inputSummary: {},
      outputSummary: null,
      status: 'failed',
      durationMs: 1,
      errorSummary: 'failed',
    });
    store.completeFailed({
      id: 'retry',
      status: 'failed',
      category: 'temporary',
      summary: 'temporary',
      usage,
      finishedAt: 2,
    });
    expect(store.restartFailed('cache-key', 3)?.id).toBe('retry');
    expect(store.restartFailed('cache-key', 4)).toBeNull();
    expect(store.nextToolSequence('retry')).toBe(1);
    expect(store.get('retry')).toMatchObject({
      status: 'running',
      startedAt: 3,
      finishedAt: null,
      errorSummary: null,
    });
    store.completeSucceeded({
      id: 'retry',
      cacheKey: 'cache-key',
      output: { ok: true },
      outputHash: 'c'.repeat(64),
      usage,
      finishedAt: 5,
    });
    expect(handle.client.prepare('SELECT COUNT(*) FROM agent_runs').pluck().get()).toBe(1);
  });
  it('persists nullable per-request cache details and leaves legacy rows without invented data', async () => {
    const { store, handle } = await setup();
    store.createRunning(running('billing'));
    const billing = calculateBilling({
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
      requestedAt: Date.parse('2026-10-30T14:00:00Z'),
      currency: 'USD',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      uncachedInputTokens: null,
    });
    store.completeSucceeded({
      id: 'billing',
      cacheKey: 'cache-key',
      output: { ok: true },
      outputHash: 'c'.repeat(64),
      finishedAt: 10,
      usage: { ...usage, estimatedCostMicros: billing.totalCostMicros, billingCalls: [billing] },
    });
    expect(store.get('billing')?.billingCalls).toEqual([billing]);
    store.createRunning(running('legacy', 'legacy-cache'));
    expect(
      handle.client
        .prepare('SELECT model_usage_json FROM agent_runs WHERE id = ?')
        .pluck()
        .get('legacy'),
    ).toBeNull();
    expect(store.get('legacy')?.billingCalls ?? null).toBeNull();
  });
  it('backfills only matching completed unpriced costs and preserves the run facts', async () => {
    const { store } = await setup();
    // 1、构造已完成但未定价的运行，输出与时间必须在回填后保持不变。
    store.createRunning(running('cost-backfill'));
    store.completeSucceeded({
      id: 'cost-backfill',
      cacheKey: 'cache-key',
      output: { result: 'synthetic' },
      outputHash: 'c'.repeat(64),
      finishedAt: 10,
      usage: { ...usage, estimatedCostMicros: null, pricingVersion: 'unpriced' },
    });
    const before = store.get('cost-backfill');
    const correction = { id: 'cost-backfill', startedAt: 1, usage };
    // 2、用量不符时拒绝覆盖；成功后只改变三个计价字段，重复回填无效。
    expect(store.backfillUnpricedCost({ ...correction, startedAt: 2 })).toBe(false);
    expect(store.backfillUnpricedCost(correction)).toBe(true);
    expect(store.get('cost-backfill')).toEqual({
      ...before,
      estimatedCostMicros: usage.estimatedCostMicros,
      costCurrency: usage.costCurrency,
      pricingVersion: usage.pricingVersion,
    });
    expect(store.backfillUnpricedCost(correction)).toBe(false);
    expect(() =>
      store.backfillUnpricedCost({
        ...correction,
        usage: { ...usage, estimatedCostMicros: -1 },
      }),
    ).toThrow(/Invalid cost correction/);
  });
  it('invalidates a bad success without deleting its audit and allows a new winner', async () => {
    const { store } = await setup();
    store.createRunning(running('invalid'));
    store.completeSucceeded({
      id: 'invalid',
      cacheKey: 'cache-key',
      output: { bad: true },
      outputHash: 'c'.repeat(64),
      usage,
      finishedAt: 2,
    });
    store.invalidateSucceeded('invalid');
    expect(store.findSucceeded('cache-key')).toBeNull();
    expect(store.get('invalid')).toMatchObject({
      status: 'failed',
      output: { bad: true },
      inputTokens: 10,
    });
    store.createRunning(running('valid'));
    expect(
      store.completeSucceeded({
        id: 'valid',
        cacheKey: 'cache-key',
        output: { valid: true },
        outputHash: 'd'.repeat(64),
        usage,
        finishedAt: 3,
      }).kind,
    ).toBe('stored');
  });
  it('allows failure then success for the same cache key and only caches success', async () => {
    const { handle, store } = await setup();
    store.createRunning(running('run-failed'));
    store.completeFailed({
      id: 'run-failed',
      status: 'failed',
      category: 'rate_limited',
      summary: 'Rate limited.',
      usage,
      finishedAt: 2,
    });
    expect(store.findSucceeded('cache-key')).toBeNull();

    store.createRunning(running('run-success'));
    const success = store.completeSucceeded({
      id: 'run-success',
      cacheKey: 'cache-key',
      output: { skills: ['TypeScript'] },
      outputHash: 'e'.repeat(64),
      usage,
      finishedAt: 3,
    });
    expect(success.kind).toBe('stored');
    expect(store.findSucceeded('cache-key')?.output).toEqual({ skills: ['TypeScript'] });
    expect(handle.client.prepare('SELECT count(*) FROM agent_runs').pluck().get()).toBe(2);
  });

  it('resolves concurrent successful completion to the existing cache winner', async () => {
    const { handle, store } = await setup();
    store.createRunning(running('run-one'));
    store.createRunning(running('run-two'));
    store.completeSucceeded({
      id: 'run-one',
      cacheKey: 'cache-key',
      output: { winner: 1 },
      outputHash: 'f'.repeat(64),
      usage,
      finishedAt: 2,
    });
    const race = store.completeSucceeded({
      id: 'run-two',
      cacheKey: 'cache-key',
      output: { winner: 2 },
      outputHash: '0'.repeat(64),
      usage,
      finishedAt: 3,
    });

    expect(race).toMatchObject({ kind: 'race', record: { id: 'run-one', output: { winner: 1 } } });
    expect(
      handle.client
        .prepare('SELECT status, error_category FROM agent_runs WHERE id = ?')
        .get('run-two'),
    ).toEqual({ status: 'failed', error_category: 'cache_race_resolved' });
    expect(
      handle.client
        .prepare("SELECT count(*) FROM agent_runs WHERE cache_key = ? AND status = 'succeeded'")
        .pluck()
        .get('cache-key'),
    ).toBe(1);
  });

  it('stores redacted tool summaries without raw input or output', async () => {
    const { handle, store } = await setup();
    store.createRunning(running('run-tool'));
    store.saveToolCall({
      id: 'tool-one',
      agentRunId: 'run-tool',
      sequenceNo: 0,
      toolKey: 'profile.read',
      inputSummary: { profileIdPresent: true },
      outputSummary: { skillCount: 3 },
      status: 'succeeded',
      durationMs: 4,
      errorSummary: null,
    });
    const row = handle.client
      .prepare('SELECT sequence_no, payload_json FROM events WHERE id = ?')
      .get('tool-one');
    expect(row).toMatchObject({ sequence_no: 1 });
    expect(JSON.parse((row as { payload_json: string }).payload_json)).toMatchObject({
      inputSummary: { profileIdPresent: true },
      outputSummary: { skillCount: 3 },
    });
  });
});
