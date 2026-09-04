#!/usr/bin/env node

import { resolveAppConfig, resolveBootstrapConfig, type AppConfig } from '@jobhunter/application';
import { createSafeLogger } from '@jobhunter/observability';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createPlaywrightSourcePageClient,
  createProductionWorkerApplication,
  runWorkerProcess,
} from './index.js';

/** 执行 Worker 任务、浏览器访问或进程管理辅助逻辑。 */
async function readOptionalJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

/** 执行 Worker 任务、浏览器访问或进程管理辅助逻辑。 */
async function loadConfig(): Promise<AppConfig> {
  const bootstrap = resolveBootstrapConfig({ environment: process.env });
  return resolveAppConfig({
    bootstrap,
    environment: process.env,
    file: await readOptionalJson(bootstrap.configPath.value),
  });
}

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}

// 1、加载配置；2、创建生产 Worker；3、注册退出处理；4、启动主循环。
const config = await loadConfig();
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
