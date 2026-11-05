import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { acquireTaskServiceLock, canonicalTaskDataRoot } from '../persistence/task-service-lock.js';
import { loadRuntimeAppConfig, SecretString, type AppConfig } from '../config/index.js';
import { AsyncSemaphore } from './async-semaphore.js';
import { ensureTaskService } from './service-client.js';
import { startCentralTaskService } from './service-host.js';
export { startCentralTaskService } from './service-host.js';
import {
  ProcessTaskExecutor,
  ProcessNetworkSemaphore,
  serveTaskExecutor,
} from './process-executor.js';
import type { TaskApplication, TaskRuntimeOptions } from './runtime.js';

export {
  requestTaskService,
  stopTaskService,
  TaskServiceConnectionError,
} from './service-client.js';

/** 配置来源标签不影响等价性；密钥参与摘要但绝不通过 IPC 或日志传输明文。 */
export function taskServiceConfiguration(config: AppConfig): string {
  function values(value: unknown): unknown {
    if (value instanceof SecretString) return value.reveal();
    if (Array.isArray(value)) return value.map(values);
    if (value && typeof value === 'object') {
      if ('value' in value && 'source' in value) return values(value.value);
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, values(entry)]),
      );
    }
    return value;
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        runtime: 4,
        config: values({
          ...config,
          bootstrap: {
            ...config.bootstrap,
            dataRoot: {
              ...config.bootstrap.dataRoot,
              value: canonicalTaskDataRoot(config.bootstrap.dataRoot.value),
            },
          },
        }),
      }),
    )
    .digest('hex');
}

/** 客户端按需启动独立生命周期的内部服务，不在 CLI/Web 内执行任务循环。 */
export async function ensureConfiguredTaskService(
  config: AppConfig,
  input: {
    readonly entry: URL;
    readonly workspaceRoot: string;
    readonly signal?: AbortSignal;
  },
): Promise<void> {
  await ensureTaskService({
    dataRoot: config.bootstrap.dataRoot.value,
    configuration: taskServiceConfiguration(config),
    ...(input.signal ? { signal: input.signal } : {}),
    start() {
      // 恢复持锁时不能创建日志目录或拉起候选服务；既有服务冷启动则由后续探测等待。
      const release = acquireTaskServiceLock(config.bootstrap.dataRoot.value);
      if (!release) return;
      try {
        const logs = path.join(config.bootstrap.dataRoot.value, 'logs');
        mkdirSync(logs, { recursive: true });
        const log = openSync(path.join(logs, 'task-service.log'), 'a', 0o600);
        try {
          const child = fork(fileURLToPath(input.entry), [], {
            execArgv: input.entry.pathname.endsWith('.ts')
              ? ['--import', 'tsx', '--conditions=development']
              : [],
            detached: true,
            stdio: ['ignore', log, log, 'ipc'],
            env: {
              ...process.env,
              BASE_URL: config.model.baseUrl.value,
              MODEL: config.model.modelName.value ?? '',
              API_KEY: config.model.apiKey.value?.reveal() ?? '',
              DATA_ROOT: config.bootstrap.dataRoot.value,
              TASK_INTERNAL_MODE: 'service',
              TASK_WORKSPACE_ROOT: input.workspaceRoot,
            },
          });
          // 1、创建失败由后续有界探测返回；不让子进程错误变成父入口未处理异常。
          child.on('error', () => undefined);
          child.disconnect();
          child.unref();
        } finally {
          closeSync(log);
        }
      } finally {
        release();
      }
    },
  });
}

/** 仅由 apps 内部组合根调用，统一服务与执行宿主的配置和进程生命周期。 */
export async function runInternalTaskHost(input: {
  readonly entry: URL;
  readonly createApplication: (
    config: AppConfig,
    options: Partial<TaskRuntimeOptions>,
  ) => TaskApplication;
}): Promise<void> {
  const workspaceRoot = process.env.TASK_WORKSPACE_ROOT;
  const mode = process.env.TASK_INTERNAL_MODE;
  if (!workspaceRoot || !['service', 'executor'].includes(mode ?? ''))
    throw new Error('Internal task host is not a public command.');
  const config = await loadRuntimeAppConfig({ workspaceRoot });
  if (mode === 'executor') {
    const network = new ProcessNetworkSemaphore();
    try {
      await serveTaskExecutor(
        input.createApplication(config, { executionOnly: true, networkSemaphore: network }),
      );
    } finally {
      network.close();
    }
    return;
  }
  let pool: ProcessTaskExecutor | undefined;
  const service = await startCentralTaskService({
    dataRoot: config.bootstrap.dataRoot.value,
    configuration: taskServiceConfiguration(config),
    createRuntime() {
      const network = new AsyncSemaphore(config.worker.maxConcurrentNetworkTasks.value);
      pool = new ProcessTaskExecutor(
        () =>
          fork(fileURLToPath(input.entry), [], {
            execArgv: input.entry.pathname.endsWith('.ts')
              ? [
                  '--import',
                  'tsx',
                  ...(import.meta.url.endsWith('.ts') ? ['--conditions=development'] : []),
                ]
              : [],
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            env: { ...process.env, TASK_INTERNAL_MODE: 'executor' },
          }),
        network,
      );
      let application: TaskApplication;
      try {
        application = input.createApplication(config, {
          executor: pool,
          networkSemaphore: network,
          recoverPreviousExecutions: true,
        });
      } catch (error) {
        void pool.close();
        throw error;
      }
      return {
        run: (signal) => application.engine.run(signal),
        request: (method, value) => {
          if (!application.request) throw new Error('Task service commands are unavailable');
          return application.request(method, value);
        },
        async close() {
          // 2、先停止执行进程并释放许可，再关闭父运行时的数据库与日志。
          await application.engine.shutdown();
          try {
            await pool?.close();
          } finally {
            await application.close();
          }
        },
      };
    },
  });
  if (!service) return;
  const stop = (): void => {
    void service.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await service.finished;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
