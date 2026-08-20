import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeTestDataRoot,
  createTemporaryDataRoot,
  FakeClock,
  FakeModel,
  makeCandidateProfile,
  makeNormalizedJob,
  SeededRandom,
} from '../src/index.js';

describe('testkit', () => {
  it('uses deterministic clocks and random numbers', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect([first.next(), first.integer(1, 10)]).toEqual([second.next(), second.integer(1, 10)]);

    const clock = new FakeClock('2026-01-01T00:00:00.000Z');
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });

  it('creates isolated temporary data roots and cleans them idempotently', async () => {
    const dataRoot = await createTemporaryDataRoot();
    await writeFile(path.join(dataRoot.path, 'sentinel'), 'test');
    await dataRoot.cleanup();
    await dataRoot.cleanup();
    await expect(access(dataRoot.path)).rejects.toThrow();
  });

  it('rejects the workspace data root', () => {
    expect(() => {
      assertSafeTestDataRoot(path.resolve('var'));
    }).toThrow(/real workspace data root/);
  });

  it('returns queued model results without external access', async () => {
    const model = new FakeModel<{ prompt: string }, { answer: string }>();
    model.enqueue({ answer: 'fixed' });
    await expect(model.invoke({ prompt: 'hello' })).resolves.toEqual({ answer: 'fixed' });
    expect(model.calls).toEqual([{ input: { prompt: 'hello' } }]);
  });

  it('exports valid reusable domain factories', () => {
    expect(makeNormalizedJob().title).toBe('Agent 开发工程师');
    expect(makeCandidateProfile().targetRoles).toContain('大模型应用');
  });
});
