import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSafeLogger, withLogContext } from '@jobhunter/common/logging';
import {
  createPlaywrightResearchBrowserDriver,
  type ResearchBrowserDriver,
} from '@jobhunter/user/tasks/research-browser-gateway';

const fixture = vi.hoisted(() => ({
  goto: vi.fn<() => Promise<{ status(): number }>>(),
  results: vi.fn<() => Promise<{ title: string; url: string }[]>>(),
  close: vi.fn<() => Promise<void>>(),
}));
vi.mock('playwright', () => ({
  chromium: {
    launch: () => Promise.resolve({ version: () => '123.0', close: () => Promise.resolve() }),
    launchPersistentContext: () =>
      Promise.resolve({
        pages: () => [],
        route: () => Promise.resolve(),
        routeWebSocket: () => Promise.resolve(),
        addInitScript: () => Promise.resolve(),
        close: () => Promise.resolve(),
        newPage: () =>
          Promise.resolve({
            setDefaultNavigationTimeout: () => undefined,
            setDefaultTimeout: () => undefined,
            on: () => undefined,
            goto: fixture.goto,
            close: fixture.close,
            locator: () => ({
              first: () => ({ waitFor: () => Promise.resolve() }),
              count: () => Promise.resolve(0),
              evaluateAll: fixture.results,
            }),
          }),
      }),
  },
}));
vi.mock('@jobhunter/common/browser/executable', () => ({
  resolveBrowserExecutablePath: () => undefined,
}));

let driver: ResearchBrowserDriver | undefined;
beforeEach(() => {
  fixture.goto.mockReset().mockResolvedValue({ status: () => 200 });
  fixture.results.mockReset().mockResolvedValue([]);
  fixture.close.mockReset().mockResolvedValue();
});
afterEach(async () => {
  await driver?.close();
  driver = undefined;
});

/** 浏览器由替身提供，实际只启动临时本机代理，不访问外网。 */
async function createDriver(signal: AbortSignal): Promise<ResearchBrowserDriver> {
  driver = await createPlaywrightResearchBrowserDriver({
    signal,
    allowTransparentNetworkTranslation: false,
    resolveHostname: () => Promise.resolve(['8.8.8.8']),
    validateUrl: (url) => Promise.resolve(url),
    limits: {
      maximumSearches: 10,
      maximumPages: 10,
      maximumReadCalls: 10,
      maximumPageCharacters: 1000,
      maximumTotalCharacters: 10000,
      navigationTimeoutMs: 1000,
    },
  });
  return driver;
}

describe('research search failure semantics', () => {
  it('reports all-provider failure with original causes and redacted diagnostic context', async () => {
    const original = Object.assign(new Error('transport token=fixture-secret-token'), {
      code: 'ECONNRESET',
    });
    fixture.goto.mockRejectedValue(original);
    const signal = new AbortController().signal;
    const browser = await createDriver(signal);
    const lines: string[] = [];
    const logger = createSafeLogger({ stderr: { write: (line) => lines.push(line) } });
    await expect(
      withLogContext(
        { taskId: 'task-1' },
        () => browser.search('private-query', 5, signal),
        logger,
      ),
    ).rejects.toMatchObject({
      code: 'search_unavailable',
      cause: expect.objectContaining({ errors: Array(5).fill(original) }) as unknown,
    });
    expect(fixture.close).toHaveBeenCalledTimes(5);
    expect(lines.join('')).toContain('task-1');
    expect(lines.join('')).toContain('ECONNRESET');
    expect(lines.join('')).not.toContain('fixture-secret-token');
    expect(lines.join('')).not.toContain('private-query');
  });
  it('allows a successful empty provider despite failures of other providers', async () => {
    fixture.goto
      .mockRejectedValue(new Error('offline'))
      .mockResolvedValueOnce({ status: () => 200 });
    const signal = new AbortController().signal;
    const browser = await createDriver(signal);
    await expect(browser.search('fixture', 5, signal)).resolves.toEqual([]);
  });
  it('continues to a successful provider and rejects unsuccessful HTTP responses', async () => {
    fixture.goto.mockResolvedValueOnce({ status: () => 503 });
    fixture.results.mockResolvedValue([
      { title: '公开面经', url: 'https://example.test/interview' },
    ]);
    const signal = new AbortController().signal;
    const browser = await createDriver(signal);
    await expect(browser.search('fixture', 5, signal)).resolves.toHaveLength(1);
    expect(fixture.goto).toHaveBeenCalledTimes(2);
  });
  it('stops fallback immediately on cancellation and closes the active page', async () => {
    const abort = new AbortController();
    fixture.goto.mockImplementation(() => {
      abort.abort();
      return Promise.reject(new Error('aborted'));
    });
    const browser = await createDriver(abort.signal);
    await expect(browser.search('fixture', 5, abort.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(fixture.goto).toHaveBeenCalledTimes(1);
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
});
