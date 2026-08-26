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

const browserDebugEnabled = process.env.JOBHUNTER_BROWSER_DEBUG === '1';

function browserDebug(...values: unknown[]): void {
  if (browserDebugEnabled) console.error('[browser-source]', ...values);
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

interface BrowserRequestTemplate {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

interface BrowserListResponse {
  readonly url: string;
  readonly status: number;
  readonly requestBody: Record<string, unknown>;
  readonly body: unknown;
}

interface BrowserCapturedPage {
  readonly page: BrowserListPage;
  readonly template: BrowserRequestTemplate;
}

function requestHeaders(
  response: Awaited<ReturnType<Page['waitForResponse']>>,
): Readonly<Record<string, string>> {
  const forbidden =
    /^(accept-encoding|connection|content-length|cookie|host|origin|referer|sec-.*|user-agent)$/i;
  return Object.fromEntries(
    Object.entries(response.request().headers()).filter(([name]) => !forbidden.test(name)),
  );
}

function requestTemplate(
  response: Awaited<ReturnType<Page['waitForResponse']>>,
): BrowserRequestTemplate {
  return {
    url: response.url(),
    headers: requestHeaders(response),
    body: postData(response),
  };
}

async function browserListResponse(
  response: Awaited<ReturnType<Page['waitForResponse']>>,
): Promise<BrowserListResponse> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new SourceError('parse_changed', 'Browser list response was not valid JSON.', {
      cause: error,
    });
  }
  return {
    url: response.url(),
    status: response.status(),
    requestBody: postData(response),
    body,
  };
}

function readListResponse(
  response: BrowserListResponse,
  request: SourcePageCollectionRequest,
  expectedPage: number,
  expectedOffset: number,
): BrowserListPage {
  // Job records are read from the official JSON response, never from rendered
  // job-card text. The browser is only the signed session that receives it.
  const query = new URL(response.url).searchParams;
  const requestBody = response.requestBody;
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
  } else if (request.responseShape === 'meituan-jobs') {
    if (!isRecord(requestBody.page)) {
      throw new SourceError('parse_changed', 'Meituan list request has no page object.');
    }
    limit = Number(requestBody.page.pageSize);
    currentPage = Number(requestBody.page.pageNo);
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
  const body = response.body;
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
  } else if (request.responseShape === 'meituan-jobs') {
    if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.page)) {
      throw new SourceError('parse_changed', 'Meituan list response has no data/page object.');
    }
    items = body.data.list;
    total = Number(body.data.page.totalCount);
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
): Promise<BrowserCapturedPage> {
  browserDebug('waiting response', request.listEndpointPath, expectedPage, expectedOffset);
  const response = await page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === request.listEndpointPath &&
      request.allowedHosts.includes(new URL(candidate.url()).hostname) &&
      candidate.request().method() === 'POST' &&
      candidate.status() === 200,
    { timeout: timeoutMs },
  );
  browserDebug(
    'matched response',
    response.status(),
    response.url(),
    response.request().postData(),
  );
  const template = requestTemplate(response);
  browserDebug('template headers', Object.keys(template.headers));
  const parsed = await browserListResponse(response);
  return {
    page: readListResponse(parsed, request, expectedPage, expectedOffset),
    template,
  };
}

async function requestJsonPage(
  page: Page,
  request: SourcePageCollectionRequest,
  template: BrowserRequestTemplate,
  targetPage: number,
  expectedOffset: number,
): Promise<BrowserListPage> {
  const response = await page.evaluate(
    async ({ template: input, responseShape, pageNumber, offset }) => {
      const url = new URL(input.url);
      const body = { ...input.body };
      if (responseShape === 'ats-job-posts') {
        url.searchParams.set('offset', String(offset));
        body.offset = offset;
      } else if (responseShape === 'alibaba-campus') {
        body.pageIndex = pageNumber;
      } else if (responseShape === 'meituan-jobs') {
        body.page = { ...(body.page ?? {}), pageNo: pageNumber };
        body.jobType = [{ code: '2', subCode: [] }];
      } else {
        body.curPage = pageNumber;
      }
      const result = await fetch(url, {
        method: 'POST',
        headers: input.headers,
        body: JSON.stringify(body),
      });
      const text = await result.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // The boundary below reports a provider response change.
      }
      return { url: result.url, status: result.status, body: parsed };
    },
    {
      template,
      responseShape: request.responseShape,
      pageNumber: targetPage,
      offset: expectedOffset,
    },
  );
  browserDebug('replayed JSON response', targetPage, response.status, response.url);
  if (response.status !== 200) {
    throw new SourceError(
      'temporary',
      `Browser JSON pagination returned HTTP ${String(response.status)}.`,
    );
  }
  return readListResponse(
    {
      url: response.url,
      status: response.status,
      requestBody:
        request.responseShape === 'ats-job-posts'
          ? { ...template.body, offset: expectedOffset }
          : request.responseShape === 'alibaba-campus'
            ? { ...template.body, pageIndex: targetPage }
            : request.responseShape === 'meituan-jobs'
              ? {
                  ...template.body,
                  page: {
                    ...(isRecord(template.body.page) ? template.body.page : {}),
                    pageNo: targetPage,
                  },
                }
              : { ...template.body, curPage: targetPage },
      body: response.body,
    },
    request,
    targetPage,
    expectedOffset,
  );
}

async function collectJsonPages(
  page: Page,
  request: SourcePageCollectionRequest,
  options: BrowserSourceOptions,
): Promise<SourcePageCollection> {
  const [firstCapture] = await Promise.all([
    waitForListResponse(page, request, 1, 0, request.timeoutMs),
    page.goto(request.url, {
      waitUntil: 'domcontentloaded',
      timeout: options.navigationTimeoutMs ?? request.timeoutMs,
    }),
  ]);
  const firstTemplate = firstCapture.template;
  // The campus landing page initially requests graduate + internship jobs.
  // Reuse the initialized anonymous session but narrow the JSON body to the
  // independently configured internship channel before collecting page 1.
  const first =
    request.responseShape === 'meituan-jobs'
      ? await requestJsonPage(page, request, firstTemplate, 1, 0)
      : firstCapture.page;
  const pages = [];
  const maximumPages = Math.min(request.maximumPages, options.maximumPages ?? 1_000);
  let coverage: SourcePageCollection['coverage'] = 'complete';
  let totalChanged = false;
  let duplicateIds = 0;
  const seenIds = new Set<string>();
  let current = first;
  const expectedPages = first.total === 0 ? 0 : Math.ceil(first.total / first.limit);
  for (let pageNumber = 1; pageNumber <= Math.min(expectedPages, maximumPages); pageNumber += 1) {
    if (request.signal.aborted)
      throw new SourceError('temporary', 'Browser collection was aborted.');
    if (current.total !== first.total || current.limit !== first.limit) {
      coverage = 'partial';
      totalChanged = true;
    }
    if (current.items.length > current.limit) coverage = 'partial';
    pages.push({
      page: pageNumber,
      url: page.url(),
      records: current.items.map((raw) => {
        const rawId = raw.id ?? raw.jobId ?? raw.positionId ?? raw.publishId ?? raw.jobUnionId;
        const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
        if (!id) throw new SourceError('parse_changed', 'Browser list record has no stable ID.');
        if (seenIds.has(id)) {
          coverage = 'partial';
          duplicateIds += 1;
        }
        seenIds.add(id);
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
      current = await requestJsonPage(
        page,
        request,
        firstTemplate,
        pageNumber + 1,
        pageNumber * first.limit,
      );
    }
  }
  if (pages.length < expectedPages) coverage = 'partial';
  const truncated = pages.length < expectedPages;
  return {
    pages,
    coverage,
    diagnostics: {
      reason: truncated
        ? 'maximum_pages_reached'
        : totalChanged
          ? 'pagination_total_changed'
          : duplicateIds > 0
            ? 'duplicate_job_ids'
            : null,
      retryable: totalChanged,
      expectedCount: first.total,
      discoveredCount: seenIds.size,
      expectedPages,
      fetchedPages: pages.length,
      duplicateIds,
      totalChanged,
    },
  };
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
          if (browserDebugEnabled) {
            page.on('request', (candidate) => {
              if (candidate.url().includes(request.listEndpointPath))
                browserDebug('request', candidate.method(), candidate.url());
            });
            page.on('response', (candidate) => {
              if (candidate.url().includes(request.listEndpointPath))
                browserDebug('response', candidate.status(), candidate.url());
            });
          }
          return collectJsonPages(page, request, options);
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
