import { describe, expect, it } from 'vitest';
import { resolveAppConfig, resolveBootstrapConfig } from '@jobhunter/application';
import { createTemporaryDataRoot } from '@jobhunter/testkit';
import { createLocalWebContainer } from '../src/server/container.js';
import {
  normalizeLoopbackHost,
  resolveWebChildEnvironment,
  resolveWebServerConfig,
} from '../src/server/host.js';

describe('Web loopback startup policy', () => {
  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('accepts loopback host %s', (host) => {
    expect(normalizeLoopbackHost(host)).toMatch(/^(127\.0\.0\.1|::1)$/);
  });

  it.each(['0.0.0.0', '::', '192.168.1.20', 'jobhunter.local'])(
    'rejects non-loopback host %s',
    (host) => {
      expect(() => normalizeLoopbackHost(host)).toThrow(/只能监听 loopback/);
    },
  );

  it('validates the port at startup', () => {
    expect(
      resolveWebServerConfig({ HOST: 'localhost', PORT: '4321', NODE_ENV: 'production' }),
    ).toEqual({
      host: '127.0.0.1',
      port: 4321,
      development: false,
    });
    expect(() => resolveWebServerConfig({ PORT: '0' })).toThrow(/PORT/);
  });

  it('enables source exports only for development child processes', () => {
    expect(
      resolveWebChildEnvironment(
        { NODE_ENV: 'development', NODE_OPTIONS: '--trace-warnings' },
        true,
      ),
    ).toEqual({
      NODE_ENV: 'development',
      NODE_OPTIONS: '--trace-warnings --conditions=development',
    });
    expect(
      resolveWebChildEnvironment(
        { NODE_ENV: 'development', NODE_OPTIONS: '--conditions=development' },
        true,
      ),
    ).toEqual({ NODE_ENV: 'development', NODE_OPTIONS: '--conditions=development' });
    expect(
      resolveWebChildEnvironment(
        { NODE_ENV: 'production', NODE_OPTIONS: '--trace-warnings' },
        false,
      ),
    ).toEqual({ NODE_ENV: 'production', NODE_OPTIONS: '--trace-warnings' });
  });

  it('composes read and task services over the configured local database', async () => {
    const root = await createTemporaryDataRoot('jobhunter-web-container-');
    try {
      const bootstrap = resolveBootstrapConfig({
        cli: { dataRoot: root.path },
        environment: {},
        cwd: root.path,
      });
      const container = createLocalWebContainer(resolveAppConfig({ bootstrap, environment: {} }));
      try {
        expect(container.services.jobs.list({ limit: 10 }).items).toEqual([]);
        expect(container.services.sources.list()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ slug: 'tencent-intern', effectiveEnabled: true }),
          ]),
        );
        expect(container.services.tasks.list()).toEqual([]);
      } finally {
        container.close();
      }
    } finally {
      await root.cleanup();
    }
  });
});
