import { parseId, parseNormalizedJob } from '@jobhunter/domain';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  assertFixtureContainsNoSensitiveContent,
  assertPublicCollectionStrategy,
  canonicalizeOfficialUrl,
  collectDiscovery,
  createExternalIdFingerprint,
  defineSourceContractSuite,
  FetchSourceHttpClient,
  SourceError,
  type DiscoverContext,
  type DiscoveryEvent,
  type JobSourceAdapter,
  type SourceHttpClient,
  type SourceHttpResponse,
} from '../src/index.js';

const sourceId = parseId('018f0000-0000-7000-8000-000000000001', 'JobSource');
const companyId = parseId('018f0000-0000-7000-8000-000000000002', 'Company');

const unusedHttp: SourceHttpClient = {
  request: () => Promise.reject(new Error('HTTP is not expected in this fixture.')),
};

interface FixtureConfig {
  readonly partial: boolean;
}

function fixtureAdapter(): JobSourceAdapter<FixtureConfig, never> {
  return {
    metadata: {
      key: 'fixture.structured',
      version: '1.0.0',
      company: { slug: 'fixture', name: 'Fixture' },
      recruitmentType: 'social',
      canonicalEntryUrl: 'https://careers.example.com/jobs',
      officialHosts: ['careers.example.com'],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 20, burst: 2 },
      externalIdFingerprintVersion: null,
    },
    configSchema: z.object({ partial: z.boolean() }).strict(),
    async *discover(context): AsyncIterable<DiscoveryEvent> {
      await Promise.resolve();
      for (const [index, externalJobId] of ['job-1', 'job-2'].entries()) {
        if (context.signal.aborted) {
          throw new SourceError('temporary', 'Discovery was aborted.');
        }
        yield {
          type: 'job',
          job: {
            externalJobId,
            sourceUrl: `https://careers.example.com/jobs/${externalJobId}`,
            raw: { id: externalJobId, title: index === 0 ? 'Agent Engineer' : 'LLM Engineer' },
          },
        };
        yield { type: 'page', page: index + 1, discoveredCount: index + 1 };
      }
      yield {
        type: 'complete',
        coverage: context.config.partial ? 'partial' : 'complete',
        cursor: null,
        pages: 2,
        discoveredCount: 2,
      };
    },
    normalize(input, context) {
      const raw = z.object({ id: z.string(), title: z.string() }).parse(input.discovered.raw);
      return Promise.resolve({
        job: parseNormalizedJob({
          companyId: context.companyId,
          sourceId: context.sourceId,
          externalJobId: raw.id,
          title: raw.title,
          department: null,
          jobFamily: null,
          locations: [],
          employmentType: null,
          experienceText: null,
          educationText: null,
          description: 'Fixture description',
          detailUrl: canonicalizeOfficialUrl(
            `${input.discovered.sourceUrl};jsessionid=secret?utm_source=test`,
            ['careers.example.com'],
          ),
          applyUrl: `https://careers.example.com/jobs/${raw.id}/apply`,
          publishedAt: null,
        }),
        provenance: { title: '$.title' },
        sourcePrivateJson: {},
      });
    },
    healthCheck: () =>
      Promise.resolve({
        status: 'healthy',
        checkedAt: 1,
        latencyMs: 1,
        signals: [{ key: 'list_shape', ok: true, diagnostic: null }],
        errorCategory: null,
      }),
  };
}

function context(config: FixtureConfig = { partial: false }): DiscoverContext<FixtureConfig> {
  return {
    sourceId,
    companyId,
    requestId: 'fixture-request',
    config,
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    http: unusedHttp,
    cursor: null,
  };
}

describe('source adapter contract', () => {
  const normalizationCase = {
    discovered: {
      externalJobId: 'job-1',
      sourceUrl: 'https://careers.example.com/jobs/job-1',
      raw: { id: 'job-1', title: 'Agent Engineer' },
    },
    detail: null,
  };
  const cases = defineSourceContractSuite(fixtureAdapter, {
    context: context(),
    expectedExternalJobIds: ['job-1', 'job-2'],
    expectedCoverage: 'complete',
    normalizationCases: [normalizationCase],
    fixtureText: JSON.stringify(normalizationCase),
  });
  for (const contractCase of cases) {
    it(contractCase.name, async () => {
      await contractCase.run();
    });
  }

  it('reports partial rather than complete when a page cannot be trusted', async () => {
    const result = await collectDiscovery(fixtureAdapter().discover(context({ partial: true })));
    expect(result.completion.coverage).toBe('partial');
  });

  it('stops discovery after cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    const cancelled = { ...context(), signal: abort.signal };
    await expect(collectDiscovery(fixtureAdapter().discover(cancelled))).rejects.toMatchObject({
      category: 'temporary',
    });
  });
});

describe('source identity, URL and registry policy', () => {
  it('preserves canonical SPA detail routes while removing tracking parameters', () => {
    expect(
      canonicalizeOfficialUrl(
        'https://campus.jd.com/#/details?utm_source=test&type=present&id=4864',
        ['campus.jd.com'],
      ),
    ).toBe('https://campus.jd.com/#/details?id=4864&type=present');
  });

  it('creates versioned deterministic fallback IDs', () => {
    const input = {
      sourceKey: 'fixture',
      algorithmVersion: 'v1',
      parts: { title: 'Agent Engineer', locations: ['北京'], department: null },
    } as const;
    expect(createExternalIdFingerprint(input)).toBe(createExternalIdFingerprint(input));
    expect(createExternalIdFingerprint(input)).toMatch(/^fp:v1:[0-9a-f]{64}$/);
  });

  it('removes session and tracking data and rejects unofficial URLs', () => {
    expect(
      canonicalizeOfficialUrl(
        'https://careers.example.com/jobs/1;jsessionid=abc?b=2&utm_source=x&a=1#top',
        ['careers.example.com'],
      ),
    ).toBe('https://careers.example.com/jobs/1?a=1&b=2');
    expect(() =>
      canonicalizeOfficialUrl('http://careers.example.com/jobs/1', ['careers.example.com']),
    ).toThrow(SourceError);
    expect(() =>
      canonicalizeOfficialUrl('https://evil.example/jobs/1', ['careers.example.com']),
    ).toThrow(SourceError);
  });

  it('validates registration, unique keys and source configuration', () => {
    const registry = new AdapterRegistry();
    registry.register(fixtureAdapter());
    expect(registry.resolve('fixture.structured', { partial: false }).config).toEqual({
      partial: false,
    });
    expect(() => {
      registry.register(fixtureAdapter());
    }).toThrow(/Duplicate adapter key/);
    expect(() => {
      registry.resolve('fixture.structured', {});
    }).toThrow(/configuration is invalid/);
    expect(() => {
      registry.resolve('missing', {});
    }).toThrow(/No adapter is registered/);
  });

  it('rejects authenticated or challenge-bypassing collection strategies and sensitive fixtures', () => {
    expect(() => {
      assertPublicCollectionStrategy({
        requiresLogin: true,
        usesSessionCookie: false,
        bypassesChallenge: false,
      });
    }).toThrow(/prohibited/);
    expect(() => {
      assertFixtureContainsNoSensitiveContent('Authorization: Bearer secret');
    }).toThrow(/sensitive material/);
  });
});

function request(
  client: FetchSourceHttpClient,
  overrides: Partial<{ signal: AbortSignal }> = {},
): Promise<SourceHttpResponse<unknown>> {
  return client.request({
    sourceKey: 'fixture',
    requestId: 'request-1',
    url: 'https://careers.example.com/jobs',
    allowedHosts: ['careers.example.com'],
    signal: overrides.signal ?? new AbortController().signal,
    responseType: 'json',
    timeoutMs: 1_000,
    maximumResponseBytes: 64,
  });
}

function fetchReturning(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}

describe('FetchSourceHttpClient', () => {
  it('returns bounded JSON and applies the project request headers', async () => {
    let received: RequestInit | undefined;
    const fetchImplementation: typeof fetch = (_input, init) => {
      received = init;
      return Promise.resolve(
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const client = new FetchSourceHttpClient({
      fetchImplementation,
    });
    await expect(request(client)).resolves.toMatchObject({ body: { jobs: [] } });
    expect(new Headers(received?.headers).get('user-agent')).toContain('JobHunter');
    expect(new Headers(received?.headers).get('x-jobhunter-request-id')).toBe('request-1');
  });

  it.each([
    [403, 'access_blocked'],
    [404, 'not_found'],
    [500, 'temporary'],
  ] as const)('classifies HTTP %i as %s', async (status, category) => {
    const client = new FetchSourceHttpClient({
      fetchImplementation: fetchReturning(new Response('', { status })),
    });
    await expect(request(client)).rejects.toMatchObject({ category });
  });

  it('preserves Retry-After and refuses verification pages or oversized bodies', async () => {
    const limited = new FetchSourceHttpClient({
      fetchImplementation: fetchReturning(
        new Response('', { status: 429, headers: { 'retry-after': '60' } }),
      ),
    });
    const rateLimitError: unknown = await request(limited).catch((error: unknown) => error);
    expect(rateLimitError).toBeInstanceOf(SourceError);
    expect(rateLimitError).toMatchObject({ category: 'rate_limited' });
    if (rateLimitError instanceof SourceError) {
      expect(rateLimitError.retryAfterAt).not.toBeNull();
    }

    const challenged = new FetchSourceHttpClient({
      fetchImplementation: fetchReturning(new Response('请完成验证码')),
    });
    await expect(
      challenged.request({
        sourceKey: 'fixture',
        requestId: 'request-2',
        url: 'https://careers.example.com/jobs',
        allowedHosts: ['careers.example.com'],
        signal: new AbortController().signal,
        responseType: 'text',
      }),
    ).rejects.toMatchObject({ category: 'access_blocked' });

    const oversized = new FetchSourceHttpClient({
      fetchImplementation: fetchReturning(new Response('x'.repeat(100), { status: 200 })),
    });
    await expect(request(oversized)).rejects.toMatchObject({ category: 'parse_changed' });
  });

  it('propagates cancellation without attempting to bypass it', async () => {
    const fetchImplementation: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        init?.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    const client = new FetchSourceHttpClient({
      fetchImplementation,
    });
    const abort = new AbortController();
    const pending = request(client, { signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ category: 'temporary' });
  });
});
