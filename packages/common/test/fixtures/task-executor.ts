import { ProcessNetworkSemaphore, serveTaskExecutor } from '../../src/tasks/process-executor.js';
import { setTimeout } from 'node:timers/promises';

const network = new ProcessNetworkSemaphore();
await serveTaskExecutor({
  async executeAssigned(task, signal) {
    if (task.taskType === 'fixture.crash') process.exit(7);
    return network.run(signal, async () => {
      const started = Date.now();
      await setTimeout(30, undefined, { signal });
      return { started, finished: Date.now(), pid: process.pid, payload: task.payload };
    });
  },
  close() {
    network.close();
    return Promise.resolve();
  },
});
