import { appendFile, writeFile } from 'node:fs/promises';
import { isMainThread, threadId } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../../src/config/index.js';
import { createTaskRuntime, type TaskRuntimeOptions } from '../../src/tasks/host/runtime.js';
import { runTaskThreadEntry } from '../../src/tasks/host/host-entry.js';
import { voidTaskOutputSchema } from '../../src/tasks/contracts/handler-registry.js';

/** 合成宿主持续写计数文件，验证入口强杀后工作线程不再执行。 */
export function createConfiguredTaskApplication(
  config: AppConfig,
  options: Partial<TaskRuntimeOptions> = {},
) {
  return createTaskRuntime({ dataRoot: config.bootstrap.dataRoot.value, ...options }, [
    (context) => {
      context.registry.register({
        taskType: 'fixture.tick',
        payloadSchema: z.object({}),
        outputSchema: voidTaskOutputSchema,
        defaultMaxAttempts: 3,
        leaseDurationMs: 120_000,
        async execute({ signal }) {
          // 1、记录真实执行身份，证明调度宿主和业务执行共享进程、分属线程。
          await writeFile(
            path.join(context.dataRoot, 'executor.json'),
            JSON.stringify({ pid: process.pid, threadId, isMainThread }),
          );
          while (!signal.aborted) {
            await appendFile(path.join(context.dataRoot, 'ticks.txt'), '.');
            await delay(40, undefined, { signal });
          }
        },
      });
      return {
        initialize() {
          context.tasks.enqueue({ taskType: 'fixture.tick', payload: {}, idempotencyKey: 'tick' });
        },
        close: () => Promise.resolve(),
      };
    },
  ]);
}
await runTaskThreadEntry({
  createApplication: createConfiguredTaskApplication,
});
