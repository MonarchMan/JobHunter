import type { AppConfig } from '../../config/index.js';
import { isMainThread, workerData, type MessagePort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import {
  createThreadLogger,
  type SafeLogger,
  createSafeLogger,
  minimumLogLevel,
} from '../../logging/index.js';
import type { TaskApplication, TaskRuntimeOptions } from './runtime.js';
import path from 'node:path';

/** 宿主统一解析任务配置并管理日志；业务能力由入口回调提供。 */
export function createConfiguredTaskHost(
  config: AppConfig,
  assemble: (options: TaskRuntimeOptions) => TaskApplication,
  borrowedLogger?: SafeLogger,
): TaskApplication {
  // 1、只映射通用配置，common 不解释邮箱、简历或招聘任务。
  const threadData = workerData as { logPort?: MessagePort; hostRunId?: string } | null;
  const ownedLogger =
    borrowedLogger ??
    (!isMainThread && threadData?.logPort
      ? createThreadLogger(
          threadData.logPort,
          minimumLogLevel(config.logLevel.value, config.consoleLogLevel?.value ?? 'warn'),
        )
      : createSafeLogger({
          level: config.logLevel.value,
          consoleLevel: config.consoleLogLevel?.value ?? 'warn',
          format: config.logFormat?.value ?? 'auto',
          logFile: path.join(config.bootstrap.dataRoot.value, 'logs', 'jobhunter.log'),
        }));
  const logger = ownedLogger.child({
    ...(!borrowedLogger ? { hostRunId: !isMainThread ? threadData?.hostRunId : randomUUID() } : {}),
    component: !isMainThread ? 'task-thread' : 'scheduler',
  });
  const closeLogger = (): Promise<void> =>
    borrowedLogger ? Promise.resolve() : ownedLogger.close();
  let application: TaskApplication;
  try {
    application = assemble({
      dataRoot: config.bootstrap.dataRoot.value,
      logger,
      pollIntervalMs: config.worker.pollIntervalMs.value,
      maxConcurrentNetworkTasks: config.worker.maxConcurrentNetworkTasks.value,
      taskTypeConcurrency: config.worker.taskTypeConcurrency.value,
      ...(config.model.modelName.value && config.model.apiKey.value
        ? {
            model: {
              provider: config.model.provider.value,
              baseUrl: config.model.baseUrl.value,
              model: config.model.modelName.value,
              apiKey: config.model.apiKey.value.reveal(),
              cacheReadPrice:
                config.model.cacheReadPrice.source === 'default'
                  ? undefined
                  : config.model.cacheReadPrice.value,
              cacheWritePrice:
                config.model.cacheWritePrice.source === 'default'
                  ? undefined
                  : config.model.cacheWritePrice.value,
              cacheWrite1hPrice:
                config.model.cacheWrite1hPrice.source === 'default'
                  ? undefined
                  : config.model.cacheWrite1hPrice.value,
              autoModelPricing:
                config.model.inputCostPerMillionUsd.source === 'default' &&
                config.model.outputCostPerMillionUsd.source === 'default',
              inputCostPerMillionUsd: config.model.inputCostPerMillionUsd.value,
              outputCostPerMillionUsd: config.model.outputCostPerMillionUsd.value,
              costCurrency: config.model.costCurrency.value,
            },
          }
        : {}),
    });
  } catch (error) {
    void closeLogger();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    engine: application.engine,
    ...(application.request ? { request: application.request.bind(application) } : {}),
    ...(application.executeAssigned
      ? { executeAssigned: application.executeAssigned.bind(application) }
      : {}),
    close() {
      // 2、任务与外部资源回收完成后才关闭日志，重复关闭复用同一结果。
      return (closing ??= application.close().finally(() => closeLogger()));
    },
  };
}
