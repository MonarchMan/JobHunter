import { describe, expect, it, vi } from 'vitest';
import { createRetryableSingleton } from '../src/server/retryable-singleton.js';

describe('Web initialization recovery', () => {
  it('coalesces concurrent attempts, backs off failures and retains success', async () => {
    let now = 0;
    const value = {};
    const factory = vi
      .fn<() => Promise<object>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(value);
    const get = createRetryableSingleton(factory, () => now);
    const first = get();
    expect(get()).toBe(first);
    await expect(first).rejects.toThrow('temporary failure');
    await expect(get()).rejects.toThrow('temporary failure');
    expect(factory).toHaveBeenCalledTimes(1);
    now = 1000;
    expect(await get()).toBe(value);
    expect(await get()).toBe(value);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
