import { describe, expect, it, vi } from 'vitest';
import {
  adapterRegistryCheck,
  dataRootCheck,
  localStateHealthCheck,
  modelConfigurationCheck,
  nodeRuntimeCheck,
  OfflineDoctorService,
} from '../src/index.js';

describe('offline doctor', () => {
  it('reports a missing optional model as degraded without invoking a model', async () => {
    const databaseProbe = vi.fn(() => ({
      status: 'healthy' as const,
      summary: 'SQLite、FTS5 与 Schema 正常。',
      recommendation: null,
      details: { schemaVersion: '0000' },
    }));
    const report = await new OfflineDoctorService({
      checks: [
        { key: 'database', severity: 'required', run: databaseProbe },
        modelConfigurationCheck(false),
      ],
      versions: { app: '0.1.0', schema: '0000', ruleset: 'v1', prompt: '1.0.0' },
      now: () => 123,
    }).run();

    expect(databaseProbe).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      status: 'degraded',
      checkedAt: 123,
      versions: { schema: '0000', ruleset: 'v1' },
      checks: [
        { key: 'database', status: 'healthy' },
        { key: 'model.configuration', status: 'degraded' },
      ],
    });
  });

  it('fails only when a required check fails and never exposes thrown details', async () => {
    const report = await new OfflineDoctorService({
      checks: [
        {
          key: 'data-root',
          severity: 'required',
          run: () => {
            throw new Error('secret path detail');
          },
        },
      ],
      versions: {},
    }).run();
    expect(report.status).toBe('failed');
    expect(JSON.stringify(report)).not.toContain('secret path detail');
  });

  it('checks Node 24 and configured adapter registration without network access', async () => {
    const report = await new OfflineDoctorService({
      checks: [
        nodeRuntimeCheck('24.3.0'),
        adapterRegistryCheck({
          registeredKeys: ['tencent.social'],
          configuredKeys: ['tencent.social', 'missing.social'],
        }),
      ],
      versions: {},
    }).run();
    expect(report.status).toBe('failed');
    expect(report.checks).toMatchObject([
      { key: 'runtime.node', status: 'healthy' },
      {
        key: 'sources.adapter-registry',
        status: 'failed',
        details: { missing: ['missing.social'] },
      },
    ]);
  });

  it('checks the resolved data directory without creating probe files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jobhunter-doctor-root-'));
    try {
      await expect(dataRootCheck(root).run()).resolves.toMatchObject({
        status: 'healthy',
        details: { path: root },
      });
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('reports local source, task, and file degradation from an injected snapshot', async () => {
    const result = await localStateHealthCheck({
      sources: { enabled: 2, degraded: 1, unhealthy: 0 },
      tasks: { pending: 3, running: 1, failed: 1 },
      files: { referenced: 4, missing: 0 },
    }).run();
    expect(result).toMatchObject({
      status: 'degraded',
      details: { sources: { degraded: 1 }, tasks: { failed: 1 } },
    });
  });
});
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
