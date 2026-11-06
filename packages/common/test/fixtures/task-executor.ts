import {
  ThreadNetworkSemaphore,
  serveTaskThread,
} from '../../src/tasks/execution/thread-worker.js';
import { threadId } from 'node:worker_threads';
import { setTimeout } from 'node:timers/promises';
import { TaskExecutionError } from '@jobhunter/common/tasks';

const network = new ThreadNetworkSemaphore();
await serveTaskThread({
  async executeAssigned(task, signal) {
    if (task.taskType === 'fixture.storage-error' && task.attemptCount === 1) {
      const { code } = task.payload as { code: string };
      const cause = Object.assign(
        new Error(code === 'maintenance' ? 'JOBHUNTER_DATABASE_MAINTENANCE' : 'private SQL text'),
        { code: code === 'maintenance' ? 'SQLITE_CONSTRAINT_TRIGGER' : code },
      );
      // 1、模拟同步服务包装基础设施异常，线程边界仍须保留恢复依据。
      throw new TaskExecutionError('permanent', 'Sync pipeline failed.', { cause });
    }
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
