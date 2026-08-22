import { parseId } from '@jobhunter/domain';
import {
  AdapterRegistry,
  type JobSourceAdapter,
  type SourceRequestContext,
} from '@jobhunter/source-core';
import { describe, expect, it, vi } from 'vitest';
import { OnlineSourceHealthService, type SyncSourceRecord } from '../src/index.js';
import { z } from 'zod';

const source: SyncSourceRecord = {
  id: parseId('018f0000-0000-7000-8000-00000000f001', 'JobSource'),
  companyId: parseId('018f0000-0000-7000-8000-00000000f002', 'Company'),
  adapterKey: 'fixture.health',
  config: { marker: 'configured' },
  syncPolicyVersion: 'v1',
  syncPolicy: {
    staleAfterMisses: 2,
    closeAfterMisses: 3,
    degradedAfterFailures: 2,
    unhealthyAfterFailures: 4,
    enrichNewRevisions: false,
    requestTimeoutMs: 5_000,
  },
  enabled: true,
  cursor: null,
  consecutiveFailures: 0,
};

describe('explicit online source health', () => {
  it('calls only healthCheck and never starts discovery or a model operation', async () => {
    const discover = vi.fn(() => {
      throw new Error('discover must not run');
    });
    const normalize = vi.fn(() => Promise.reject(new Error('normalize must not run')));
    const healthCheck = vi.fn((context: SourceRequestContext<{ marker: string }>) =>
      Promise.resolve({
        status: 'healthy' as const,
        checkedAt: 100,
        latencyMs: 5,
        signals: [{ key: 'minimal-endpoint', ok: true, diagnostic: context.config.marker }],
        errorCategory: null,
      }),
    );
    const adapter: JobSourceAdapter<{ marker: string }> = {
      metadata: {
        key: 'fixture.health',
        version: '1',
        company: { slug: 'fixture', name: 'Fixture' },
        recruitmentType: 'social',
        canonicalEntryUrl: 'https://careers.example.com/jobs',
        officialHosts: ['careers.example.com'],
        capabilities: { detail: 'inline', pagination: 'none', transport: 'json' },
        defaultRateLimit: { requestsPerMinute: 1, burst: 1 },
        externalIdFingerprintVersion: null,
      },
      configSchema: z.object({ marker: z.string() }).strict(),
      discover,
      normalize,
      healthCheck,
    };
    const registry = new AdapterRegistry();
    registry.register(adapter);
    const service = new OnlineSourceHealthService({
      registry,
      createContext: (record, config, signal) => ({
        sourceId: record.id,
        companyId: record.companyId,
        requestId: 'doctor-online',
        config,
        signal,
        timeoutMs: 5_000,
        http: { request: () => Promise.reject(new Error('fixture health does not use HTTP')) },
      }),
      now: () => 100,
    });

    await expect(service.check([source], new AbortController().signal)).resolves.toMatchObject([
      { sourceId: source.id, adapterKey: 'fixture.health', health: { status: 'healthy' } },
    ]);
    expect(healthCheck).toHaveBeenCalledOnce();
    expect(discover).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
  });

  it('reports an unregistered experimental source without dispatching network work', async () => {
    const createContext = vi.fn();
    const registry = new AdapterRegistry();
    const service = new OnlineSourceHealthService({
      registry,
      createContext,
      now: () => 100,
    });
    const unregistered = { ...source, adapterKey: 'blocked.source' };

    await expect(service.check([unregistered], new AbortController().signal)).resolves.toEqual([
      {
        sourceId: source.id,
        adapterKey: 'blocked.source',
        health: {
          status: 'unhealthy',
          checkedAt: 100,
          latencyMs: 0,
          signals: [{ key: 'health-check', ok: false, diagnostic: '来源健康检查失败。' }],
          errorCategory: 'invalid_config',
        },
      },
    ]);
    expect(createContext).not.toHaveBeenCalled();
  });
});
