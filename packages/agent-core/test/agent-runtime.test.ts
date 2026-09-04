import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  AgentRuntimeError,
  ModelClientError,
  PromptRegistry,
  assertPromptMatchesDefinition,
  canonicalJson,
  defineAgent,
  evaluateAssertions,
  hashCanonical,
  runEvaluation,
  sanitizeAgentErrorSummary,
  type AgentDefinition,
  type AgentRunRecord,
  type AgentRunStore,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ToolCallRecord,
} from '../src/index.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
class MemoryStore implements AgentRunStore {
  public readonly runs = new Map<string, AgentRunRecord>();
  public readonly toolCalls: ToolCallRecord[] = [];

  public findSucceeded(cacheKey: string): AgentRunRecord | null {
    return (
      [...this.runs.values()].find(
        (run) => run.cacheKey === cacheKey && run.status === 'succeeded',
      ) ?? null
    );
  }

  /** 执行测试替身或时钟的操作。 */
  public get(id: string): AgentRunRecord | null {
    return this.runs.get(id) ?? null;
  }

  /** 执行测试替身或时钟的操作。 */
  public createRunning(record: AgentRunRecord): void {
    this.runs.set(record.id, record);
  }

  /** 执行测试替身或时钟的操作。 */
  public completeSucceeded(
    input: Parameters<AgentRunStore['completeSucceeded']>[0],
  ): ReturnType<AgentRunStore['completeSucceeded']> {
    const winner = this.findSucceeded(input.cacheKey);
    if (winner) return { kind: 'race', record: winner };
    const current = this.required(input.id);
    const record: AgentRunRecord = {
      ...current,
      status: 'succeeded',
      output: input.output,
      ...input.usage,
      errorCategory: null,
      errorSummary: null,
      finishedAt: input.finishedAt,
    };
    this.runs.set(record.id, record);
    return { kind: 'stored', record };
  }

  /** 执行测试替身或时钟的操作。 */
  public completeFailed(input: Parameters<AgentRunStore['completeFailed']>[0]): AgentRunRecord {
    const current = this.required(input.id);
    const record: AgentRunRecord = {
      ...current,
      status: input.status,
      errorCategory: input.category,
      errorSummary: input.summary,
      ...input.usage,
      finishedAt: input.finishedAt,
    };
    this.runs.set(record.id, record);
    return record;
  }

  /** 执行测试替身或时钟的操作。 */
  public saveToolCall(record: ToolCallRecord): void {
    this.toolCalls.push(record);
  }

  /** 测试辅助类的内部实现。 */
  private required(id: string): AgentRunRecord {
    const run = this.runs.get(id);
    if (!run) throw new TypeError('Run not found.');
    return run;
  }
}

/** 构造测试输入或执行断言的辅助逻辑。 */
type QueuedStep =
  | ModelResponse
  | ModelClientError
  | ((request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse> | ModelResponse);

/** 构造测试输入或执行断言的辅助逻辑。 */
class QueueModel implements ModelClient {
  public readonly metadata = {
    provider: 'test',
    model: 'queue',
    config: { temperature: 0 },
    costCurrency: 'USD',
    pricingVersion: 'test-v1',
  };
  public readonly requests: ModelRequest[] = [];
  readonly #steps: QueuedStep[];

  /** 执行测试替身或时钟的操作。 */
  public constructor(steps: readonly QueuedStep[]) {
    this.#steps = [...steps];
  }

  public async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    this.requests.push(request);
    const step = this.#steps.shift();
    if (!step) throw new ModelClientError('configuration', 'No queued response.');
    if (step instanceof ModelClientError) throw step;
    return typeof step === 'function' ? step(request, signal) : step;
  }
}

const usage = { inputTokens: 3, outputTokens: 2, estimatedCostMicros: 4 };
const output = (answer: unknown): ModelResponse => ({
  kind: 'output',
  output: { answer },
  usage,
});

/** 构造测试输入或执行断言的辅助逻辑。 */
function definition(
  overrides: Partial<AgentDefinition<{ text: string }, { answer: string }>> = {},
): AgentDefinition<{ text: string }, { answer: string }> {
  return defineAgent({
    key: 'test-agent',
    version: '1.0.0',
    promptVersion: 'prompt-v1',
    outputSchemaVersion: 'schema-v1',
    outputSchemaName: 'TestOutput',
    systemPrompt: 'Return a structured answer using only the supplied input.',
    inputSchema: z.object({ text: z.string() }).strict(),
    outputSchema: z.object({ answer: z.string() }).strict(),
    tools: [],
    limits: {
      timeoutMs: 1_000,
      maxSteps: 3,
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
      maxEstimatedCostMicros: 100,
    },
    ...overrides,
  });
}

let nextId = 0;

/** 构造测试输入或执行断言的辅助逻辑。 */
function runner(store: MemoryStore, model: ModelClient): AgentRunner {
  let now = 1_000;
  return new AgentRunner({
    store,
    model,
    createId: () => `id-${String(++nextId)}`,
    now: () => ++now,
  });
}

describe('agent runtime', () => {
  it('canonicalizes input and hashes object key order consistently', () => {
    expect(canonicalJson({ b: 2, a: { y: 1, x: 0 } })).toBe('{"a":{"x":0,"y":1},"b":2}');
    expect(hashCanonical({ b: 2, a: 1 })).toBe(hashCanonical({ a: 1, b: 2 }));
  });

  it('uses only successful versioned cache entries', async () => {
    const store = new MemoryStore();
    const model = new QueueModel([output('first')]);
    const runtime = runner(store, model);
    const signal = new AbortController().signal;

    const first = await runtime.run({ definition: definition(), value: { text: 'hello' }, signal });
    const replay = await runtime.run({
      definition: definition(),
      value: { text: 'hello' },
      signal,
    });

    expect(first.cacheHit).toBe(false);
    expect(replay.cacheHit).toBe(true);
    expect(replay.output.answer).toBe('first');
    expect(model.requests).toHaveLength(1);
    expect(store.runs).toHaveLength(1);
  });

  it('changes the cache key when prompt version changes', async () => {
    const store = new MemoryStore();
    const model = new QueueModel([output('one'), output('two')]);
    const runtime = runner(store, model);
    const signal = new AbortController().signal;
    const first = await runtime.run({ definition: definition(), value: { text: 'same' }, signal });
    const second = await runtime.run({
      definition: definition({ promptVersion: 'prompt-v2' }),
      value: { text: 'same' },
      signal,
    });
    expect(second.run.cacheKey).not.toBe(first.run.cacheKey);
    expect(model.requests).toHaveLength(2);
  });

  it('retains a failed run and permits the same cache key to succeed later', async () => {
    const store = new MemoryStore();
    const failedModel = new QueueModel([
      new ModelClientError('rate_limited', 'Rate limited.', true),
    ]);
    await expect(
      runner(store, failedModel).run({
        definition: definition(),
        value: { text: 'retry' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'rate_limited', retryable: true });

    const success = await runner(store, new QueueModel([output('ok')])).run({
      definition: definition(),
      value: { text: 'retry' },
      signal: new AbortController().signal,
    });
    expect(success.output.answer).toBe('ok');
    expect([...store.runs.values()].map((run) => run.status).sort()).toEqual([
      'failed',
      'succeeded',
    ]);
  });

  it('repairs invalid structured output exactly once without tools', async () => {
    const store = new MemoryStore();
    const model = new QueueModel([output(42), output('repaired')]);
    const result = await runner(store, model).run({
      definition: definition(),
      value: { text: 'repair' },
      signal: new AbortController().signal,
    });
    expect(result.output.answer).toBe('repaired');
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.repair).toBeDefined();
    expect(model.requests[1]?.tools).toEqual([]);
  });

  it('rejects a tool that is not in the definition whitelist', async () => {
    const store = new MemoryStore();
    const model = new QueueModel([
      {
        kind: 'tool_calls',
        calls: [{ id: 'call-1', toolKey: 'shell', input: {} }],
        usage,
      },
    ]);
    await expect(
      runner(store, model).run({
        definition: definition(),
        value: { text: 'tool' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'tool_error' });
    expect(store.toolCalls).toHaveLength(0);
  });

  it('validates and records only redacted summaries for a read-only tool', async () => {
    const store = new MemoryStore();
    const model = new QueueModel([
      {
        kind: 'tool_calls',
        calls: [{ id: 'call-1', toolKey: 'lookup', input: { id: 'secret-id' } }],
        usage,
      },
      output('done'),
    ]);
    const tool = {
      key: 'lookup',
      description: 'Read one fixture.',
      readOnly: true as const,
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ detail: z.string() }),
      summarizeInput: () => ({ fields: ['id'] }),
      summarizeOutput: () => ({ fields: ['detail'] }),
      execute: () => Promise.resolve({ detail: 'sensitive output' }),
    };
    await runner(store, model).run({
      definition: definition({ tools: [tool] }),
      value: { text: 'tool' },
      signal: new AbortController().signal,
    });
    expect(store.toolCalls).toHaveLength(1);
    expect(JSON.stringify(store.toolCalls)).not.toContain('secret-id');
    expect(JSON.stringify(store.toolCalls)).not.toContain('sensitive output');
  });

  it('terminates repeated tool calls at the step budget', async () => {
    const call: ModelResponse = {
      kind: 'tool_calls',
      calls: [{ id: 'call', toolKey: 'lookup', input: { id: 'x' } }],
      usage,
    };
    const tool = {
      key: 'lookup',
      description: 'Read.',
      readOnly: true as const,
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      summarizeInput: () => ({}),
      summarizeOutput: () => ({}),
      execute: () => Promise.resolve({ value: 'x' }),
    };
    await expect(
      runner(new MemoryStore(), new QueueModel([call, call])).run({
        definition: definition({ tools: [tool], limits: { ...definition().limits, maxSteps: 2 } }),
        value: { text: 'loop' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'budget_exceeded' });
  });

  it('fails without repair when model usage exceeds cost budget', async () => {
    const costly: ModelResponse = {
      kind: 'output',
      output: { answer: 'too expensive' },
      usage: { ...usage, estimatedCostMicros: 101 },
    };
    await expect(
      runner(new MemoryStore(), new QueueModel([costly])).run({
        definition: definition(),
        value: { text: 'cost' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'budget_exceeded' });
  });

  it('enforces cancellation and timeout while preserving classified run records', async () => {
    const waitingStep = (_request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new ModelClientError('cancelled', 'Cancelled.'));
          },
          { once: true },
        );
      });

    const cancelledStore = new MemoryStore();
    const controller = new AbortController();
    const cancelled = runner(cancelledStore, new QueueModel([waitingStep])).run({
      definition: definition(),
      value: { text: 'cancel' },
      signal: controller.signal,
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ category: 'cancelled' });
    expect([...cancelledStore.runs.values()][0]?.status).toBe('cancelled');

    const timeoutStore = new MemoryStore();
    await expect(
      runner(timeoutStore, new QueueModel([waitingStep])).run({
        definition: definition({ limits: { ...definition().limits, timeoutMs: 20 } }),
        value: { text: 'timeout' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'timeout', retryable: true });
    expect([...timeoutStore.runs.values()][0]).toMatchObject({
      status: 'failed',
      errorCategory: 'timeout',
    });
  });

  it('does not persist input or prompt content in run records', async () => {
    const store = new MemoryStore();
    const secret = 'private-resume-body@example.com';
    await runner(store, new QueueModel([output('ok')])).run({
      definition: definition(),
      value: { text: secret },
      signal: new AbortController().signal,
    });
    expect(JSON.stringify([...store.runs.values()])).not.toContain(secret);
    expect(JSON.stringify([...store.runs.values()])).not.toContain('supplied input');
  });

  it('redacts secrets from persisted model error summaries', async () => {
    const store = new MemoryStore();
    await expect(
      runner(
        store,
        new QueueModel([
          new ModelClientError('temporary', 'Bearer abc123 api_key=top-secret', true),
        ]),
      ).run({
        definition: definition(),
        value: { text: 'safe input' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: 'temporary' });
    const persisted = JSON.stringify([...store.runs.values()]);
    expect(persisted).not.toContain('abc123');
    expect(persisted).not.toContain('top-secret');
    expect(sanitizeAgentErrorSummary('token=secret')).toBe('token=[redacted]');
  });
});

describe('registries and evaluation primitives', () => {
  it('rejects duplicate prompt versions', () => {
    const registry = new PromptRegistry();
    const prompt = {
      agentKey: 'resume-profile',
      promptVersion: 'v1',
      outputSchemaVersion: 'v1',
      text: 'Extract facts.',
    };
    registry.register(prompt);
    expect(() => {
      registry.register(prompt);
    }).toThrow(/Duplicate prompt/);
    expect(() => {
      assertPromptMatchesDefinition(prompt, definition());
    }).toThrow(/does not match/);
  });

  it('evaluates exact, contains and exists assertions', () => {
    expect(
      evaluateAssertions({ role: 'Agent developer', skills: ['TypeScript'] }, [
        { path: '/role', operator: 'contains', expected: 'Agent' },
        { path: '/skills/0', operator: 'equals', expected: 'TypeScript' },
        { path: '/role', operator: 'exists' },
      ]),
    ).toEqual([]);
  });

  it('exposes classified runtime errors', () => {
    expect(new AgentRuntimeError('temporary', 'Temporary.', true)).toMatchObject({
      category: 'temporary',
      retryable: true,
    });
  });

  it('reports provider, schema and quality failures without dropping failed cases', async () => {
    let current = 0;
    const report = await runEvaluation({
      agentKey: 'test-agent',
      agentVersion: '1',
      promptVersion: '1',
      modelConfigHash: 'a'.repeat(64),
      cases: [
        {
          id: 'pass',
          inputRef: 'pass',
          assertions: [{ path: '/ok', operator: 'equals', expected: true }],
        },
        {
          id: 'quality',
          inputRef: 'quality',
          assertions: [{ path: '/ok', operator: 'equals', expected: true }],
        },
        { id: 'schema', inputRef: 'schema', assertions: [] },
        { id: 'provider', inputRef: 'provider', assertions: [] },
      ],
      loadInput: (inputRef) => Promise.resolve(inputRef),
      invoke: (value) => {
        if (value === 'schema')
          return Promise.reject(new AgentRuntimeError('invalid_output', 'bad'));
        if (value === 'provider') return Promise.reject(new AgentRuntimeError('temporary', 'down'));
        return Promise.resolve({ ok: value === 'pass' });
      },
      now: () => ++current,
    });
    expect(report).toMatchObject({
      total: 4,
      passed: 1,
      providerFailures: 1,
      schemaFailures: 1,
      qualityFailures: 1,
    });
  });
});
