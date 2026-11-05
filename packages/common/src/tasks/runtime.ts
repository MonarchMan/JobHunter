import {
  SystemIdGenerator,
  parseId,
  utcInstant,
  type Clock,
  type IdGenerator,
} from '../domain/index.js';
import { z } from 'zod';
import type { CentralTaskRuntime } from './service-host.js';
import { AgentRunner, ModelClientError, type ModelClient } from '../agent/index.js';
import { createConfiguredModelClient } from '../models/index.js';
import { SqliteAgentRunStore } from '../persistence/agent-run-store.js';
import { openSqliteDatabase, type SqliteDatabaseHandle } from '../persistence/connection.js';
import { SqliteTaskRepository } from '../persistence/task-repository.js';
import { isSqliteUnavailableError } from '../persistence/busy-error.js';
import { createSqliteMaintenanceTick } from './sqlite-maintenance.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { withTaskExecution } from './execution-scope.js';
import { TaskExecutionError } from './retry-policy.js';
import type { TaskRecord } from './model.js';
import type { TaskExecutionPort } from './worker-engine.js';
import {
  AsyncSemaphore,
  AsyncSemaphoreCancelledError,
  HandlerRegistry,
  RetryPolicy,
  ScheduleService,
  TaskService,
  WorkerEngine,
  type RandomSource,
  type TaskLogger,
  type WorkerDelay,
  type WorkerEngineOptions,
} from './index.js';

/** 模块任务能力只暴露初始化与释放；处理器由工厂在给定注册表登记。 */
export interface TaskCapability {
  initialize?(): void;
  close(): Promise<void>;
}

/** 运行时给业务工厂提供通用资源，不识别具体业务任务类型。 */
export interface TaskRuntimeContext {
  readonly dataRoot: string;
  readonly database: SqliteDatabaseHandle;
  readonly registry: HandlerRegistry;
  readonly tasks: TaskService;
  readonly schedules: ScheduleService;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly networkSemaphore: AsyncSemaphore;
  readonly runner: AgentRunner | null;
  createRunner(timeoutMs?: number): AgentRunner | null;
}

/** 宿主创建任务运行时所需的通用配置，业务选项由模块自行声明。 */
export interface TaskRuntimeOptions {
  readonly executor?: TaskExecutionPort;
  readonly executionOnly?: boolean;
  /** 仅允许已经持有中央服务排他锁的组合根启用。 */
  readonly recoverPreviousExecutions?: boolean;
  readonly networkSemaphore?: AsyncSemaphore;
  readonly dataRoot: string;
  readonly workerId?: string;
  readonly pollIntervalMs?: number;
  readonly maxConcurrentNetworkTasks?: number;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
  readonly logger?: TaskLogger;
  readonly model?: Parameters<typeof createConfiguredModelClient>[0];
}

/** CLI/Web 共用任务应用；关闭必须先停止任务，再释放模块资源与数据库。 */
export interface TaskApplication {
  readonly engine: WorkerEngine;
  readonly request?: CentralTaskRuntime['request'];
  /** 内部执行宿主专用：只运行给定分派，不领取任务或启动调度。 */
  executeAssigned?(task: TaskRecord, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

/** 单个适配器释放失败也必须继续释放其他资源，最后统一报告失败。 */
async function closeCapabilities(capabilities: readonly TaskCapability[]): Promise<void> {
  // 1、按构造逆序回收所有模块；2、保留全部失败以便宿主报告。
  const failures: unknown[] = [];
  for (const capability of [...capabilities].reverse()) {
    try {
      await capability.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, '任务模块资源释放失败。');
}

/** 用通用信号量约束模型并发，不将取消误判成网络失败。 */
function limitModel(client: ModelClient, semaphore: AsyncSemaphore): ModelClient {
  return {
    metadata: client.metadata,
    async complete(request, signal) {
      // 1、等待公共网络额度；2、取消排队时转换成模型执行契约错误。
      try {
        return await semaphore.run(signal, () => client.complete(request, signal));
      } catch (error) {
        if (error instanceof AsyncSemaphoreCancelledError)
          throw new ModelClientError('cancelled', 'Model request was cancelled while queued.');
        throw error;
      }
    },
  };
}

/** 创建通用运行时，业务模块由入口注入，common 不反向导入业务实现。 */
export function createTaskRuntime(
  input: TaskRuntimeOptions,
  factories: readonly ((context: TaskRuntimeContext) => TaskCapability)[],
): TaskApplication {
  // 1、先建立所有工厂共享的连接、队列、时钟和模型运行能力。
  const database = openSqliteDatabase({
    dataRoot: input.dataRoot,
    runMigrations: !input.executionOnly,
  });
  const ids = new SystemIdGenerator();
  const clock: Clock = { now: () => utcInstant(Date.now()) };
  const registry = new HandlerRegistry();
  const queue = new SqliteTaskRepository(database.client);
  if (input.recoverPreviousExecutions) queue.revokePreviousExecutions(clock.now());
  const tasks = new TaskService({ queue, clock, ids }, registry);
  const schedules = new ScheduleService({ queue, clock, ids }, registry);
  const networkSemaphore =
    input.networkSemaphore ?? new AsyncSemaphore(input.maxConcurrentNetworkTasks ?? 4);
  const createRunner = (timeoutMs?: number): AgentRunner | null =>
    input.model
      ? new AgentRunner({
          store: new SqliteAgentRunStore(database.client),
          model: limitModel(
            createConfiguredModelClient({ ...input.model, ...(timeoutMs ? { timeoutMs } : {}) }),
            networkSemaphore,
          ),
          createId: () => ids.generate(),
          now: () => clock.now(),
        })
      : null;
  const context: TaskRuntimeContext = {
    dataRoot: input.dataRoot,
    database,
    registry,
    tasks,
    schedules,
    ids,
    clock,
    networkSemaphore,
    runner: createRunner(),
    createRunner,
  };
  const capabilities: TaskCapability[] = [];
  const abort = new AbortController();
  const eventLoopDelay = input.logger ? monitorEventLoopDelay({ resolution: 20 }) : null;
  let metrics: ReturnType<typeof setInterval> | undefined;
  try {
    // 2、先登记全部处理器，再创建计划，防止计划引用尚未注册的任务。
    for (const factory of factories) capabilities.push(factory(context));
    if (!input.executionOnly) for (const capability of capabilities) capability.initialize?.();
    // 2.a、只记录公共并发和事件循环指标，不记录业务正文或外部地址。
    if (input.logger) {
      eventLoopDelay?.enable();
      metrics = setInterval(() => {
        input.logger?.info('worker.runtime', {
          networkActive: networkSemaphore.activeCount,
          networkQueued: networkSemaphore.queuedCount,
          eventLoopDelayP95Ms: Number(
            ((eventLoopDelay?.percentile(95) ?? 0) / 1_000_000).toFixed(2),
          ),
        });
        eventLoopDelay?.reset();
      }, 30_000);
      metrics.unref();
    }
    database.client.pragma('busy_timeout = 100');
    const engine = new WorkerEngine({
      queue,
      registry,
      clock,
      scheduleService: schedules,
      retryPolicy: new RetryPolicy({ next: () => Math.random() }),
      periodicWork: createSqliteMaintenanceTick(database, input.logger, abort.signal),
      isQueueBusy: isSqliteUnavailableError,
      ...(input.executor ? { executor: input.executor } : {}),
      options: {
        workerId: input.workerId ?? `tasks-${String(process.pid)}`,
        emptyPollMinimumMs: input.pollIntervalMs ?? 1_000,
        emptyPollMaximumMs: Math.max(input.pollIntervalMs ?? 1_000, 10_000),
        schedulerPollMs: input.pollIntervalMs ?? 1_000,
        ...(input.taskTypeConcurrency ? { taskTypeConcurrency: input.taskTypeConcurrency } : {}),
      },
      ...(input.logger ? { logger: input.logger } : {}),
    });
    let closing: Promise<void> | undefined;
    return {
      engine,
      request(method, value) {
        // 1、所有 IPC 入参在通用边界校验，具体 payload 继续由处理器 Schema 校验。
        if (method === 'enqueue') {
          const command = z
            .object({
              taskType: z.string().min(1),
              payload: z.unknown(),
              idempotencyKey: z.string().min(1),
            })
            .strict()
            .parse(value);
          const result = tasks.enqueue({ ...command, payload: command.payload });
          return { kind: result.kind, taskId: result.task.id };
        }
        if (method === 'retry') {
          const request = z
            .object({ taskId: z.uuid(), token: z.string().min(1) })
            .strict()
            .parse(value);
          const result = tasks.retryFailed(parseId(request.taskId, 'Task'), request.token);
          return { kind: result.kind, taskId: result.task.id };
        }
        const request = z.object({ taskId: z.uuid() }).strict().parse(value);
        const id = parseId(request.taskId, 'Task');
        if (method === 'cancel') {
          const result = tasks.cancel(id);
          engine.notifyCancellation(id);
          return { kind: result.kind, taskId: id };
        }
        const task = tasks.get(id);
        if (!task) return null;
        return {
          id: task.id,
          taskType: task.taskType,
          status: task.status,
          attemptCount: task.attemptCount,
          result: task.result,
          errorCategory: task.errorCategory,
          errorSummary: task.errorSummary,
        };
      },
      async executeAssigned(task, signal) {
        // 1、分派输入和输出仍由所属业务 Schema 校验；检查点写入验证当前执行身份。
        if (!task.leaseOwner || task.status !== 'running')
          throw new TypeError('Invalid task dispatch');
        const owner = task.leaseOwner;
        const handler = registry.get(task.taskType);
        return withTaskExecution(
          {
            taskId: task.id,
            owner: task.leaseOwner,
            attempt: task.attemptCount,
            now: () => clock.now(),
          },
          () =>
            registry.execute(
              task.taskType,
              {
                taskId: task.id,
                attempt: task.attemptCount,
                signal,
                clock,
                logger: input.logger ?? {
                  info() {
                    /* 未配置日志时忽略诊断。 */
                  },
                  warn() {
                    /* 未配置日志时忽略诊断。 */
                  },
                  error() {
                    /* 未配置日志时忽略诊断。 */
                  },
                },
                services: {},
                checkpoint(result) {
                  if (!queue.checkpoint(task.id, owner, task.attemptCount, clock.now(), result))
                    throw new TaskExecutionError('cancelled', 'Task dispatch was revoked.');
                },
              },
              handler.retryPayload?.(task.payload, task.result) ?? task.payload,
            ),
        );
      },
      close() {
        // 3、关闭幂等并等待在途任务，资源释放顺序与构造顺序相反。
        return (closing ??= (async () => {
          abort.abort();
          if (metrics) clearInterval(metrics);
          eventLoopDelay?.disable();
          try {
            await engine.shutdown();
          } finally {
            try {
              await closeCapabilities(capabilities);
            } finally {
              database.close();
            }
          }
        })());
      },
    };
  } catch (error) {
    if (metrics) clearInterval(metrics);
    eventLoopDelay?.disable();
    // 2.a、装配失败仍回收已构造模块；连接在模块释放后关闭。
    void (async () => {
      try {
        await closeCapabilities(capabilities);
      } finally {
        database.close();
      }
    })().catch(() => {
      input.logger?.info('tasks.initialization_cleanup_failed', {});
    });
    throw error;
  }
}

/** 注入处理器的轻量任务应用，供任务机制测试使用。 */
export function createTaskApplication(input: {
  readonly dataRoot: string;
  readonly registry: HandlerRegistry;
  readonly ids: IdGenerator;
  readonly options: WorkerEngineOptions;
  readonly clock?: Clock;
  readonly random?: RandomSource;
  readonly logger?: TaskLogger;
  readonly workerDelay?: WorkerDelay;
}): TaskApplication {
  // 1、测试仍使用真实队列与引擎，仅外部执行能力由调用方替换。
  const database = openSqliteDatabase({ dataRoot: input.dataRoot });
  const queue = new SqliteTaskRepository(database.client);
  const clock = input.clock ?? { now: () => utcInstant(Date.now()) };
  const engine = new WorkerEngine({
    queue,
    registry: input.registry,
    clock,
    retryPolicy: new RetryPolicy(input.random ?? { next: () => Math.random() }),
    scheduleService: new ScheduleService({ queue, clock, ids: input.ids }, input.registry),
    options: input.options,
    ...(input.logger ? { logger: input.logger } : {}),
    ...(input.workerDelay ? { workerDelay: input.workerDelay } : {}),
  });
  let closed = false;
  return {
    engine,
    async close() {
      // 2、关闭在途执行后释放连接，重复调用不重复关闭连接。
      if (closed) return;
      closed = true;
      await engine.shutdown();
      database.close();
    },
  };
}
