import { startCentralTaskService } from '../../src/tasks/service-host.js';

const dataRoot = process.argv[2];
if (!dataRoot) throw new Error('Missing fixture data root');
const service = await startCentralTaskService({
  dataRoot,
  configuration: 'process-fixture',
  createRuntime: () => ({
    run: (signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    request: (_method, input) => input,
    close: () => Promise.resolve(),
  }),
});
process.send?.({ ready: service !== null, pid: process.pid });
if (service) await service.finished;
if (process.connected) process.disconnect();
