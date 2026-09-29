import { EventEmitter } from 'node:events';
import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerSourcePageClient } from '../src/browser-source.js';

/** 使用可观察的假浏览器验证进程与上下文所有权，不访问外部网站。 */
function fakeBrowser(): {
  browser: Browser;
  close: ReturnType<typeof vi.fn>;
  contexts: { close: ReturnType<typeof vi.fn> }[];
} {
  const events = new EventEmitter();
  let connected = true;
  const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
  const browser = {
    on: events.on.bind(events),
    isConnected: () => connected,
    newContext: vi.fn(() => {
      const context = {
        close: vi.fn(() => Promise.resolve()),
        newPage: vi.fn(() =>
          Promise.resolve({
            goto: vi.fn(() => Promise.resolve()),
            url: () => 'https://example.com',
            content: () => Promise.resolve('<html></html>'),
          }),
        ),
      };
      contexts.push(context);
      return Promise.resolve(context);
    }),
    close: vi.fn(() => {
      connected = false;
      events.emit('disconnected');
      return Promise.resolve();
    }),
  };
  return { browser: browser as unknown as Browser, close: browser.close, contexts };
}

const request = {
  sourceKey: 'fixture',
  requestId: 'fixture',
  url: 'https://example.com',
  allowedHosts: ['example.com'],
  signal: new AbortController().signal,
  timeoutMs: 5000,
  maximumResponseBytes: 1024,
};
afterEach(() => vi.restoreAllMocks());

describe('Worker source browser ownership', () => {
  it('does not launch an unused client and releases context after navigation failure', async () => {
    const fake = fakeBrowser();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(fake.browser);
    await createWorkerSourcePageClient().close();
    expect(launch).not.toHaveBeenCalled();
    const original = fake.browser.newContext.bind(fake.browser);
    vi.spyOn(fake.browser, 'newContext').mockImplementationOnce(async () => {
      const context = await original();
      const page = await context.newPage();
      vi.spyOn(page, 'goto').mockRejectedValueOnce(new Error('navigation failed'));
      vi.spyOn(context, 'newPage').mockResolvedValue(page);
      return context;
    });
    const client = createWorkerSourcePageClient();
    await expect(client.snapshot(request)).rejects.toThrow();
    expect(fake.contexts[0]?.close).toHaveBeenCalledTimes(1);
    await client.snapshot(request);
    expect(launch).toHaveBeenCalledTimes(1);
    await client.close();
  });
  it('reuses one process for queued requests and closes isolated contexts', async () => {
    const fake = fakeBrowser();
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(fake.browser);
    const client = createWorkerSourcePageClient();
    await Promise.all([
      client.snapshot(request),
      client.snapshot({ ...request, sourceKey: 'other' }),
    ]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(fake.contexts).toHaveLength(2);
    for (const context of fake.contexts) expect(context.close).toHaveBeenCalledTimes(1);
    expect(fake.close).not.toHaveBeenCalled();
    await Promise.all([client.close(), client.close()]);
    expect(fake.close).toHaveBeenCalledTimes(1);
    await expect(client.snapshot(request)).rejects.toThrow();
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('recovers from launch failure and rebuilds after disconnection', async () => {
    const first = fakeBrowser();
    const next = fakeBrowser();
    const launch = vi
      .spyOn(chromium, 'launch')
      .mockRejectedValueOnce(new Error('launch failed'))
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(next.browser);
    const client = createWorkerSourcePageClient();
    await expect(client.snapshot(request)).rejects.toThrow();
    await client.snapshot(request);
    await first.browser.close();
    await client.snapshot(request);
    expect(launch).toHaveBeenCalledTimes(3);
    await client.close();
    expect(next.close).toHaveBeenCalledTimes(1);
  });
  it('closes a browser whose launch completes during shutdown', async () => {
    const fake = fakeBrowser();
    let finish!: (browser: Browser) => void;
    vi.spyOn(chromium, 'launch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = createWorkerSourcePageClient();
    const task = client.snapshot(request);
    const rejected = expect(task).rejects.toThrow();
    await vi.waitFor(() => {
      expect(finish).toBeTypeOf('function');
    });
    const closing = client.close();
    finish(fake.browser);
    await Promise.all([closing, rejected]);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.contexts).toHaveLength(0);
  });
});
