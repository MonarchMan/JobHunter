import type { AgentRunRecord, AgentRunUsage } from '@jobhunter/agent-core';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  SqliteAgentRunStore,
  type SqliteDatabaseHandle,
} from '../src/index.js';

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
      usage,
      finishedAt: 2,
    });
    const race = store.completeSucceeded({
      id: 'run-two',
      cacheKey: 'cache-key',
      output: { winner: 2 },
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
