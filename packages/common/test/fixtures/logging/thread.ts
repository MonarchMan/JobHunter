import { workerData } from 'node:worker_threads';
import { AgentRuntimeError } from '../../../src/agent/errors.js';
import { createThreadLogger } from '../../../src/logging/thread-channel.js';
import { withTaskExecution } from '../../../src/tasks/contracts/execution-scope.js';
import { serveTaskThread } from '../../../src/tasks/execution/thread-worker.js';

// 1、合成线程只使用日志通道，不打开数据库或日志文件。
const logger = createThreadLogger(workerData.logPort, 'debug');
await serveTaskThread({
  executeAssigned(task) {
    return withTaskExecution(
      {
        taskId: task.id,
        attempt: task.attemptCount,
        owner: task.leaseOwner!,
        now: Date.now,
        logger,
      },
      async () => {
        for (let index = 0; index < 12; index++)
          logger.info('fixture.thread', { index, padding: 'x'.repeat(400) });
        if ((task.payload as { storage?: string }).storage === 'tool')
          throw new AgentRuntimeError('tool_error', 'Tool failed.', false, {
            cause: Object.assign(
              new Error('synthetic token=private', { cause: new Error('root cause') }),
              { code: 'SQLITE_BUSY' },
            ),
          });
        if ((task.payload as { fail?: boolean }).fail)
          throw Object.assign(
            new Error('synthetic token=private', { cause: new Error('root cause') }),
            {
              code: (task.payload as { storage?: boolean }).storage ? 'SQLITE_ERROR' : 'ECONNRESET',
            },
          );
        return { done: true };
      },
    );
  },
  close: () => logger.close(),
});
