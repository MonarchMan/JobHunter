import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  BrowserPool,
  type BrowserSession,
  type BrowserSessionFactory,
  createPooledSourcePageClient,
} from '@jobhunter/sources';
import {
  SourceError,
  type SourcePageClient,
  type SourcePageCollectionRequest,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { existsSync } from 'node:fs';

interface BrowserSourceOptions {
  readonly headless?: boolean;
  readonly executablePath?: string;
  readonly navigationTimeoutMs?: number;
  readonly maximumPages?: number;
}

function resolveExecutablePath(options: BrowserSourceOptions): string | undefined {
  if (options.executablePath) return options.executablePath;
  const configured = process.env.JOBHUNTER_BROWSER_EXECUTABLE;
  if (configured) return configured;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : [];
  return candidates.find((candidate) => existsSync(candidate));
}

async function launchBrowser(options: BrowserSourceOptions): Promise<Browser> {
  const executablePath = resolveExecutablePath(options);
  return chromium.launch({
    headless: options.headless ?? true,
    ...(executablePath ? { executablePath } : {}),
  });
}

async function assertPublicPage(page: Page): Promise<void> {
  const text = (await page.locator('body').innerText()).slice(0, 20_000).toLowerCase();
  if (/captcha|验证码|访问验证|安全验证|verify you are human|登录后/.test(text)) {
    throw new SourceError('access_blocked', 'Official page displayed an access challenge.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detailUrlFor(requestUrl: string, id: string): string {
  const url = new URL(requestUrl);
  const basePath = url.pathname.replace(/\/list\/?$/, '').replace(/\/$/, '');
  url.pathname = `${basePath}/${id}/detail`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function postData(response: Awaited<ReturnType<Page['waitForResponse']>>): Record<string, unknown> {
  try {
    const value: unknown = response.request().postDataJSON();
    if (isRecord(value)) return value;
  } catch {
    // Normalize all provider-specific request parsing failures below.
  }
  throw new SourceError('parse_changed', 'Browser list request body was not valid JSON.');
}

interface BrowserListPage {
  readonly items: Record<string, unknown>[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number | null;
}

async function readListResponse(
  response: Awaited<ReturnType<Page['waitForResponse']>>,
  request: SourcePageCollectionRequest,
  expectedPage: number,
  expectedOffset: number,
): Promise<BrowserListPage> {
  const query = new URL(response.url()).searchParams;
  const requestBody = postData(response);
  const queryLimit = Number(query.get('limit'));
  const queryOffset = Number(query.get('offset'));
  let limit: number;
  let currentPage: number;
  let offset: number | null = null;
  if (request.responseShape === 'ats-job-posts') {
    limit = queryLimit;
    offset = queryOffset;
    currentPage = Math.floor(offset / limit) + 1;
  } else if (request.responseShape === 'alibaba-campus') {
    limit = Number(requestBody.pageSize);
    currentPage = Number(requestBody.pageIndex);
  } else {
    limit = Number(requestBody.pageSize);
    currentPage = Number(requestBody.curPage);
  }
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(currentPage) ||
    currentPage < 1
  ) {
    throw new SourceError(
      'parse_changed',
      'Browser list response has invalid pagination parameters.',
    );
  }
  if (currentPage !== expectedPage || (offset !== null && offset !== expectedOffset)) {
    throw new SourceError(
      'parse_changed',
      'Browser list response pagination did not match the requested page.',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new SourceError('parse_changed', 'Browser list response was not valid JSON.', {
      cause: error,
    });
  }
  let items: unknown;
  let total: number;
  if (request.responseShape === 'ats-job-posts') {
    if (!isRecord(body) || !isRecord(body.data)) {
      throw new SourceError('parse_changed', 'Browser list response has no data object.');
    }
    items = body.data.job_post_list;
    total = Number(body.data.count);
  } else if (request.responseShape === 'alibaba-campus') {
    if (!isRecord(body) || !isRecord(body.content)) {
      throw new SourceError('parse_changed', 'Alibaba list response has no content object.');
    }
    items = body.content.datas;
    total = Number(body.content.totalCount);
  } else {
    if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.pageVO)) {
      throw new SourceError('parse_changed', 'Huawei list response has no pageVO object.');
    }
    items = body.data.result;
    total = Number(body.data.pageVO.totalRows);
  }
  if (
    !Array.isArray(items) ||
    !items.every(isRecord) ||
    !Number.isSafeInteger(total) ||
    total < 0
  ) {
    throw new SourceError(
      'parse_changed',
      'Browser list response no longer matches the verified schema.',
    );
  }
  return { items, total, limit, offset };
}

async function waitForListResponse(
  page: Page,
  request: SourcePageCollectionRequest,
  expectedPage: number,
  expectedOffset: number,
  timeoutMs: number,
): Promise<BrowserListPage> {
  const response = await page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === request.listEndpointPath &&
      request.allowedHosts.includes(new URL(candidate.url()).hostname) &&
      candidate.request().method() === 'POST' &&
      candidate.status() === 200,
    { timeout: timeoutMs },
  );
  return readListResponse(response, request, expectedPage, expectedOffset);
}

async function clickRenderedPage(
  page: Page,
  request: SourcePageCollectionRequest,
  targetPage: number,
  expectedOffset: number,
  timeoutMs: number,
): Promise<BrowserListPage> {
  const direct = page
    .locator(
      `li[title="${String(targetPage)}"], button.next-pagination-item, li.pager-item-pager-pc, li.pager-item-active-pc`,
    )
    .filter({ hasText: new RegExp(`^${String(targetPage)}$`) })
    .last();
  let control = direct;
  if ((await direct.count()) === 0) {
    control = page
      .locator(
        'li[title="下一页"], li[aria-label="下一页"], button.next-next, button[aria-label="下一页"], a[aria-label="下一页"]',
      )
      .last();
  }
  if ((await control.count()) === 0 || !(await control.isEnabled().catch(() => false))) {
    throw new SourceError(
      'parse_changed',
      `Browser pagination control for page ${String(targetPage)} is unavailable.`,
    );
  }
  if ((await control.getAttribute('aria-disabled')) === 'true') {
    throw new SourceError(
      'parse_changed',
      `Browser pagination stopped before page ${String(targetPage)}.`,
    );
  }
  const response = waitForListResponse(page, request, targetPage, expectedOffset, timeoutMs);
  if (request.responseShape === 'ats-job-posts') {
    await control.evaluate('element => element.click()');
  } else {
    await control.click({ force: true, timeout: Math.min(timeoutMs, 10_000) });
  }
  return response;
}

async function collectRenderedPages(
  page: Page,
  request: SourcePageCollectionRequest,
  options: BrowserSourceOptions,
): Promise<SourcePageCollection> {
  const firstResponse = waitForListResponse(page, request, 1, 0, request.timeoutMs);
  await page.goto(request.url, {
    waitUntil: 'domcontentloaded',
    timeout: options.navigationTimeoutMs ?? request.timeoutMs,
  });
  const first = await firstResponse;
  await page.waitForTimeout(1_000);
  await assertPublicPage(page);
  const pages = [];
  const maximumPages = Math.min(request.maximumPages, options.maximumPages ?? 1_000);
  let coverage: SourcePageCollection['coverage'] = 'complete';
  let current = first;
  const expectedPages = first.total === 0 ? 0 : Math.ceil(first.total / first.limit);
  for (let pageNumber = 1; pageNumber <= Math.min(expectedPages, maximumPages); pageNumber += 1) {
    if (request.signal.aborted)
      throw new SourceError('temporary', 'Browser collection was aborted.');
    await assertPublicPage(page);
    if (current.total !== first.total || current.limit !== first.limit) coverage = 'partial';
    if (current.items.length > current.limit) coverage = 'partial';
    pages.push({
      page: pageNumber,
      url: page.url(),
      records: current.items.map((raw) => {
        const rawId = raw.id ?? raw.jobId ?? raw.positionId ?? raw.publishId;
        const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
        if (!id) throw new SourceError('parse_changed', 'Browser list record has no stable ID.');
        const explicitUrl = [raw.detailUrl, raw.sourceUrl, raw.url, raw.positionUrl].find(
          (value): value is string => typeof value === 'string' && value.startsWith('https://'),
        );
        const detailUrl =
          explicitUrl ??
          (request.responseShape === 'ats-job-posts' ? detailUrlFor(request.url, id) : null);
        return {
          ...raw,
          id,
          ...(detailUrl ? { detailUrl } : {}),
        };
      }),
      total: current.total,
      capturedAt: Date.now(),
    });
    if (pageNumber < expectedPages && pageNumber < maximumPages) {
      current = await clickRenderedPage(
        page,
        request,
        pageNumber + 1,
        pageNumber * first.limit,
        request.timeoutMs,
      );
    }
  }
  if (pages.length < expectedPages) coverage = 'partial';
  return { pages, coverage };
}

function createSessionFactory(
  options: BrowserSourceOptions,
): BrowserSessionFactory<SourcePageClient> {
  return {
    create(): Promise<BrowserSession<SourcePageClient>> {
      let browser: Browser | undefined;
      let context: BrowserContext | undefined;
      const pageClient: SourcePageClient = {
        async snapshot(request) {
          browser ??= await launchBrowser(options);
          context ??= await browser.newContext();
          const page = await context.newPage();
          await page.goto(request.url, {
            waitUntil: 'domcontentloaded',
            timeout: request.timeoutMs,
          });
          return { url: page.url(), html: await page.content(), capturedAt: Date.now() };
        },
        async collect(request) {
          browser ??= await launchBrowser(options);
          context ??= await browser.newContext();
          const page = await context.newPage();
          return collectRenderedPages(page, request, options);
        },
      };
      return Promise.resolve({
        page: pageClient,
        async close() {
          await context?.close();
          await browser?.close();
        },
      });
    },
  };
}

export function createPlaywrightSourcePageClient(
  options: BrowserSourceOptions = {},
): SourcePageClient {
  return createPooledSourcePageClient(new BrowserPool(createSessionFactory(options)));
}
