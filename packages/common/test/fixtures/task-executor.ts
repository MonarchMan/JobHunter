import {
  ThreadNetworkSemaphore,
  serveTaskThread,
} from '../../src/tasks/execution/thread-worker.js';
import { threadId } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';

const network = new ThreadNetworkSemaphore();
await serveTaskThread({
  async executeAssigned(task, signal) {
    if (task.taskType === 'fixture.crash') process.exit(7);
    if (task.taskType === 'fixture.throttle')
      await network.beforeSourceRequest(
        'fixture-source',
        { requestsPerMinute: 600, burst: 1 },
        signal,
      );
    return network.run(signal, async () => {
      const started = Date.now();
      await setTimeout(30, undefined, { signal });
      return { started, finished: Date.now(), pid: process.pid, threadId, payload: task.payload };
    });
  },
  close() {
    network.close();
    return Promise.resolve();
  },
});
