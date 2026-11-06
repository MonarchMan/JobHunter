import { parseId } from '../domain/index.js';
import { observeTaskEnqueues } from './execution-scope.js';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalTaskDataRoot, readTaskHostOwner } from '../persistence/task-service-lock.js';
import { SecretString, type AppConfig } from '../config/index.js';
import { AsyncSemaphore } from './async-semaphore.js';
import { requestTaskService } from './host-bridge-client.js';
import { startTaskHostBridge } from './host-bridge.js';
import { ThreadTaskExecutor } from './thread-executor.js';
import { ThreadNetworkSemaphore, serveTaskThread } from './thread-worker.js';
import type { TaskApplication, TaskRuntimeOptions } from './runtime.js';
export { requestTaskService, HostBridgeConnectionError } from './host-bridge-client.js';
export {
  acquireTaskServiceLock,
  readTaskHostOwner,
  withTaskServiceOwnership,
} from '../persistence/task-service-lock.js';

/** 配置来源标签不影响等价性；密钥参与摘要但绝不通过 IPC 或日志传输明文。 */
export function taskHostConfiguration(config: AppConfig): string {
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
        runtime: 5,
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

/** 组合根显式提供业务能力，common 不反向导入业务模块。 */
interface TaskHostInput {
  readonly entry: URL;
  readonly signal?: AbortSignal;
  readonly mode?: 'web' | 'cli';
}
/** 线程配置快照仅通过内部通道传递，SecretString 在目标线程恢复。 */
function serializeConfig(config: AppConfig): string {
  function visit(value: unknown): unknown {
    if (value instanceof SecretString) return { __taskSecret: value.reveal() };
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  }
  return JSON.stringify(visit(config));
}

/** 单进程同目录唯一宿主，CLI 根任务集合限制领取范围。 */
interface LocalTaskHost {
  token: string;
  roots: Set<string>;
  finished: Promise<void>;
  close(): Promise<void>;
  notifyCancellation(taskId: string): void;
  workflow(): readonly { id: string; status: string }[];
}
const hosts = new Map<string, Promise<LocalTaskHost>>();

/** 创建绑定入口生命周期的运行时；竞争失败绝不附着其他入口。 */
export async function startConfiguredTaskHost(
  config: AppConfig,
  input: TaskHostInput,
): Promise<LocalTaskHost> {
  const key = canonicalTaskDataRoot(config.bootstrap.dataRoot.value);
  const existing = hosts.get(key);
  if (existing) return existing;
  let cleanupObserver = (): void => undefined;
  const starting = (async (): Promise<LocalTaskHost> => {
    const module = (await import(input.entry.href)) as {
      createConfiguredTaskApplication?: (
        config: AppConfig,
        options?: Partial<TaskRuntimeOptions>,
      ) => TaskApplication;
    };
    const createApplication = module.createConfiguredTaskApplication;
    if (!createApplication) throw new Error('Task entry must export its application factory');
    const token = randomBytes(32).toString('hex');
    const roots = new Set<string>();
    const unobserve =
      input.mode === 'web' ? () => undefined : observeTaskEnqueues((id) => roots.add(id));
    cleanupObserver = unobserve;
    let application: TaskApplication | undefined;
    let pool: ThreadTaskExecutor | undefined;
    const service = await startTaskHostBridge({
      dataRoot: key,
      configuration: taskHostConfiguration(config),
      token,
      ownerKind: input.mode ?? 'cli',
      async createRuntime() {
        const network = new AsyncSemaphore(config.worker.maxConcurrentNetworkTasks.value);
        pool = new ThreadTaskExecutor(
          () => {
            const worker = new Worker(
              input.entry.pathname.endsWith('.ts')
                ? "require('tsx/esm/api').tsImport(require('node:worker_threads').workerData.entry, require('node:url').pathToFileURL(process.cwd() + '/').href).catch(() => process.exit(1))"
                : "import(require('node:worker_threads').workerData.entry).catch(() => process.exit(1))",
              {
                eval: true,
                stdout: true,
                stderr: true,
                workerData: {
                  entry: input.entry.href,
                  config: serializeConfig(config),
                },
                execArgv: input.entry.pathname.endsWith('.ts') ? ['--conditions=development'] : [],
              },
            );
            // 1.b、线程原始输出不进入 CLI JSON 或公开诊断；结构化日志已由业务运行时写入日志文件。
            worker.stdout.resume();
            worker.stderr.resume();
            return worker;
          },
          network,
          config.worker.threadPool?.value,
        );
        try {
          application = createApplication(config, {
            executor: pool,
            networkSemaphore: network,
            recoverPreviousExecutions: true,
            periodicEnabled: input.mode === 'web',
            rootTaskIds: () => (input.mode === 'web' ? undefined : [...roots]),
          });
          await pool.initialize();
        } catch (error) {
          await pool.close();
          await application?.close();
          throw error;
        }
        const runtime = application;
        const executor = pool;
        return {
          run: (signal) => runtime.engine.run(signal),
          request: (method, value) => {
            if (!runtime.request) throw new Error('Task commands unavailable');
            return runtime.request(method, value);
          },
          async close() {
            // 1、停止领取及取消；2、确认线程退出；3、关闭主运行时连接。
            await runtime.engine.shutdown();
            try {
              await executor.close();
            } finally {
              await runtime.close();
            }
          },
        };
      },
    });
    if (!service) {
      unobserve();
      const owner = readTaskHostOwner(key);
      throw new Error(
        '同一数据目录已有 Web/CLI 或旧任务服务运行，请先停止原入口。' +
          (owner ? `（${owner.kind}，PID ${String(owner.pid)}，启动于 ${owner.startedAt}）` : ''),
      );
    }
    const stop = (): void => {
      void service.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const closed = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      hosts.delete(key);
      unobserve();
    };
    void service.finished.then(closed, closed);
    return {
      token,
      roots,
      finished: service.finished,
      close: () => service.close(),
      notifyCancellation: (taskId) =>
        application?.engine.notifyCancellation(parseId(taskId, 'Task')),
      workflow: () =>
        (application?.request?.('workflow', [...roots]) as
          | readonly {
              id: string;
              status: string;
            }[]
          | undefined) ?? [],
    };
  })();
  hosts.set(key, starting);
  try {
    return await starting;
  } catch (error) {
    cleanupObserver();
    hosts.delete(key);
    throw error;
  }
}

/** Next 子进程只确认宿主桥；CLI 在本进程启动，不再 fork 后台服务。 */
export async function ensureConfiguredTaskHost(
  config: AppConfig,
  input: TaskHostInput,
): Promise<void> {
  input.signal?.throwIfAborted();
  if (process.env.TASK_HOST_TOKEN) {
    await requestTaskService({
      dataRoot: config.bootstrap.dataRoot.value,
      configuration: taskHostConfiguration(config),
      method: 'ping',
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return;
  }
  const host = await startConfiguredTaskHost(config, input);
  if (input.signal?.aborted) {
    await host.close();
    input.signal.throwIfAborted();
  }
}

/** 本地入口取消后立即通知主线程，不等待下一次租约心跳。 */
export async function notifyConfiguredTaskCancellation(
  config: AppConfig,
  taskId: string,
): Promise<void> {
  const host = await hosts.get(canonicalTaskDataRoot(config.bootstrap.dataRoot.value));
  host?.notifyCancellation(taskId);
}

/** CLI 显式登记目标根，不消费历史无关任务。 */
export async function allowConfiguredTask(config: AppConfig, taskId: string): Promise<void> {
  const host = await hosts.get(canonicalTaskDataRoot(config.bootstrap.dataRoot.value));
  if (!host) throw new Error('Task host is not running');
  host.roots.add(taskId);
}

/** 命令结束前等待目标工作流；中断关闭会自然结束等待，最终统一回收线程。 */
export async function finishConfiguredTaskHost(config: AppConfig): Promise<void> {
  const host = await hosts.get(canonicalTaskDataRoot(config.bootstrap.dataRoot.value));
  if (!host) return;
  try {
    while (host.workflow().some((task) => task.status === 'pending' || task.status === 'running')) {
      const active = await Promise.race([
        delay(100).then(() => true),
        host.finished.then(() => false),
      ]);
      if (!active) break;
    }
  } finally {
    await host.close();
  }
}

/** 工作线程入口只执行已分派任务；主线程导入此模块仅取得组合工厂。 */
export async function runTaskThreadEntry(input: {
  readonly createApplication: (
    config: AppConfig,
    options: Partial<TaskRuntimeOptions>,
  ) => TaskApplication;
}): Promise<void> {
  if (isMainThread) return;
  const data = workerData as { config: string };
  const config = JSON.parse(data.config, (_key, value: unknown) =>
    value && typeof value === 'object' && '__taskSecret' in value
      ? new SecretString(String(value.__taskSecret))
      : value,
  ) as AppConfig;
  const network = new ThreadNetworkSemaphore();
  try {
    await serveTaskThread(
      input.createApplication(config, { executionOnly: true, networkSemaphore: network }),
    );
  } finally {
    network.close();
  }
}
