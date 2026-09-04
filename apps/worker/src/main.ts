#!/usr/bin/env node

import { loadRuntimeAppConfig } from '@jobhunter/application';
import { createSafeLogger } from '@jobhunter/observability';
import path from 'node:path';
import {
  createPlaywrightSourcePageClient,
  createProductionWorkerApplication,
  runWorkerProcess,
} from './index.js';

// 1、加载配置；2、创建生产 Worker；3、注册退出处理；4、启动主循环。
const workspaceRoot =
  process.env.JOBHUNTER_WORKSPACE_ROOT ?? path.resolve(import.meta.dirname, '../../..');
const config = await loadRuntimeAppConfig({ workspaceRoot });
const logger = createSafeLogger({
  level: config.logLevel.value,
  logFile: path.join(config.bootstrap.dataRoot.value, 'logs', 'jobhunter.log'),
});
try {
  const worker = createProductionWorkerApplication({
    dataRoot: config.bootstrap.dataRoot.value,
    pollIntervalMs: config.worker.pollIntervalMs.value,
    maxConcurrentNetworkTasks: config.worker.maxConcurrentNetworkTasks.value,
    taskTypeConcurrency: config.worker.taskTypeConcurrency.value,
    logger,
    pageClient: createPlaywrightSourcePageClient(),
    ...(config.model.provider.value &&
    config.model.baseUrl.value &&
    config.model.modelName.value &&
    config.model.apiKey.value
      ? {
          model: {
            provider: config.model.provider.value,
            baseUrl: config.model.baseUrl.value,
            model: config.model.modelName.value,
            apiKey: config.model.apiKey.value.reveal(),
          },
        }
      : {}),
  });
  await runWorkerProcess(worker);
} finally {
  await logger.close();
}
