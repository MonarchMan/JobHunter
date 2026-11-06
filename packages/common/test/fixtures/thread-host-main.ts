import { resolveAppConfig, resolveBootstrapConfig } from '../../src/config/index.js';
import { startConfiguredTaskHost } from '../../src/tasks/host/host-entry.js';

const root = process.argv[2];
if (!root) throw new Error('Fixture data directory is required');
const config = resolveAppConfig({
  bootstrap: resolveBootstrapConfig({ cli: { dataRoot: root }, environment: {}, cwd: root }),
  environment: { TASK_THREAD_POOL: '{"startupTimeoutMs":60000}' },
});
const host = await startConfiguredTaskHost(config, {
  entry: new URL('./thread-host-application.ts', import.meta.url),
  mode: 'web',
});
process.on('message', (message) => {
  if (message === 'shutdown') void host.close();
});
process.send?.('ready');
try {
  await host.finished;
} finally {
  process.disconnect?.();
}
