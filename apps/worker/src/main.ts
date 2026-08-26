#!/usr/bin/env node

import { resolveAppConfig, resolveBootstrapConfig, type AppConfig } from '@jobhunter/application';
import { readFile } from 'node:fs/promises';
import {
  createPlaywrightSourcePageClient,
  createProductionWorkerApplication,
  runWorkerProcess,
} from './index.js';

async function readOptionalJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

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

const config = await loadConfig();
const worker = createProductionWorkerApplication({
  dataRoot: config.bootstrap.dataRoot.value,
  pollIntervalMs: config.worker.pollIntervalMs.value,
  taskTypeConcurrency: config.worker.taskTypeConcurrency.value,
  pageClient: createPlaywrightSourcePageClient(),
  ...(config.model.baseUrl.value && config.model.modelName.value && config.model.apiKey.value
    ? {
        model: {
          baseUrl: config.model.baseUrl.value,
          model: config.model.modelName.value,
          apiKey: config.model.apiKey.value.reveal(),
        },
      }
    : {}),
});

await runWorkerProcess(worker);
