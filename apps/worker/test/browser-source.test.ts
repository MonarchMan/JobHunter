import { SourceError } from '@jobhunter/source-core';
import { describe, expect, it } from 'vitest';
import {
  buildBrowserPageRequest,
  createPlaywrightSourcePageClient,
  resolveBrowserExecutablePath,
  shouldReplayFirstPage,
  type BrowserExecutableRuntime,
} from '../src/browser-source.js';

function runtime(overrides: Partial<BrowserExecutableRuntime> = {}): BrowserExecutableRuntime {
  return {
    platform: 'darwin',
    homeDirectory: '/Users/tester',
    exists: () => false,
    ...overrides,
  };
}

describe('browser executable resolution', () => {
  it('prefers an explicit option and then the configured environment path', () => {
    expect(
      resolveBrowserExecutablePath(
        { executablePath: '/custom/option-browser' },
        runtime({ configuredPath: '/custom/environment-browser' }),
      ),
    ).toBe('/custom/option-browser');
    expect(
      resolveBrowserExecutablePath({}, runtime({ configuredPath: '/custom/environment-browser' })),
    ).toBe('/custom/environment-browser');
  });

  it('detects Chrome and Edge in macOS system and user application directories', () => {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(
      resolveBrowserExecutablePath({}, runtime({ exists: (path) => path === systemChrome })),
    ).toBe(systemChrome);

    const userEdge = '/Users/tester/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    expect(resolveBrowserExecutablePath({}, runtime({ exists: (path) => path === userEdge }))).toBe(
      userEdge,
    );
  });
});

describe('browser startup diagnostics', () => {
  it('keeps a stable safe summary and retains the underlying Playwright launch error', async () => {
    const page = createPlaywrightSourcePageClient({
      executablePath: '/definitely-missing-jobhunter-browser',
    });

    let failure: unknown;
    try {
      await page.snapshot({
        sourceKey: 'diagnostic.fixture',
        requestId: 'browser-startup-diagnostic',
        url: 'https://example.com',
        allowedHosts: ['example.com'],
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        maximumResponseBytes: 1_024,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SourceError);
    expect(failure).toMatchObject({
      category: 'temporary',
      safeDiagnostic: 'Browser operation failed.',
    });
    const cause = (failure as SourceError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toMatch(/executable doesn't exist/i);
    expect((cause as Error).message).toContain('/definitely-missing-jobhunter-browser');
  });
});

describe('browser JSON pagination', () => {
  it('overrides the NetEase UI page size with the adapter configuration', () => {
    const target = buildBrowserPageRequest(
      {
        url: 'https://hr.163.com/api/hr163/position/queryPage',
        headers: { accept: 'application/json' },
        body: { currentPage: 1, pageSize: 2 },
      },
      'netease-jobs',
      3,
      200,
      100,
    );

    expect(target).toMatchObject({
      method: 'POST',
      body: { currentPage: 3, pageSize: 100 },
    });
  });

  it('replays page one when the captured UI capacity differs from configured capacity', () => {
    const request = {
      sourceKey: 'netease.mixed',
      requestId: 'netease-page-size-regression',
      url: 'https://hr.163.com/job-list.html',
      allowedHosts: ['hr.163.com'],
      signal: new AbortController().signal,
      timeoutMs: 15_000,
      maximumPages: 1_000,
      maximumResponseBytes: 2 * 1024 * 1024,
      pageSize: 100,
      listEndpointPath: '/api/hr163/position/queryPage',
      responseShape: 'netease-jobs' as const,
    };

    expect(shouldReplayFirstPage(request, 2)).toBe(true);
    expect(shouldReplayFirstPage(request, 100)).toBe(false);
  });
});
