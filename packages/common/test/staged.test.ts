import { describe, expect, it, vi } from 'vitest';
import { runStagedItems } from '../src/tasks/staged.js';

describe('runStagedItems', () => {
  it('executes items in order, checkpoints after each and returns all results', async () => {
    const checkpoint = vi.fn();
    const items = await runStagedItems({
      keys: ['a', 'b', 'c'],
      signal: new AbortController().signal,
      checkpoint,
      run: (key) => Promise.resolve(`ok-${key}`),
      onCancelled: () => new Error('cancelled') as never,
    });

    expect(items).toEqual([
      { key: 'a', status: 'succeeded', result: 'ok-a', error: null },
      { key: 'b', status: 'succeeded', result: 'ok-b', error: null },
      { key: 'c', status: 'succeeded', result: 'ok-c', error: null },
    ]);
    expect(checkpoint).toHaveBeenCalledTimes(3);
  });

  it('skips previously succeeded items and resumes failed ones', async () => {
    const previous = [
      { key: 'a', status: 'succeeded' as const, result: 'old-a', error: null },
      { key: 'b', status: 'failed' as const, result: null, error: 'failed' },
    ];
    const run = vi.fn((key: string) => Promise.resolve(`new-${key}`));
    const items = await runStagedItems({
      keys: ['a', 'b'],
      previous,
      signal: new AbortController().signal,
      run,
      onCancelled: () => new Error('cancelled') as never,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('b', previous[1]);
    expect(items[0]?.result).toBe('old-a');
    expect(items[1]?.result).toBe('new-b');
  });

  it('classifies individual failures without stopping the rest', async () => {
    const items = await runStagedItems({
      keys: ['a', 'b'],
      signal: new AbortController().signal,
      run: (key) => (key === 'a' ? Promise.reject(new Error('boom')) : Promise.resolve('ok')),
      onCancelled: () => new Error('cancelled') as never,
    });

    expect(items[0]?.status).toBe('failed');
    expect(items[0]?.error).toBeTruthy();
    expect(items[1]?.status).toBe('succeeded');
  });

  it('stops on cancellation before the next item', async () => {
    const controller = new AbortController();
    const run = vi.fn((key: string) => {
      if (key === 'a') controller.abort();
      return Promise.resolve('ok');
    });
    await expect(
      runStagedItems({
        keys: ['a', 'b', 'c'],
        signal: controller.signal,
        run,
        onCancelled: (items) => Object.assign(new Error('cancelled'), { result: items }) as never,
      }),
    ).rejects.toMatchObject({ result: [{ key: 'a', status: 'succeeded' }] });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
