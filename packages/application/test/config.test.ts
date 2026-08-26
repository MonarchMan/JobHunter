import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppConfig, resolveBootstrapConfig, SecretString } from '../src/index.js';

describe('two-stage configuration', () => {
  it('resolves bootstrap only from CLI, environment, and defaults', () => {
    const bootstrap = resolveBootstrapConfig({
      cwd: 'C:/workspace',
      cli: { dataRoot: './cli-data' },
      environment: {
        JOBHUNTER_DATA_ROOT: './env-data',
        JOBHUNTER_CONFIG_PATH: './env-config.json',
      },
    });
    expect(bootstrap).toEqual({
      dataRoot: { value: resolve('C:/workspace', 'cli-data'), source: 'cli' },
      configPath: { value: resolve('C:/workspace', 'env-config.json'), source: 'environment' },
    });
  });

  it('applies CLI then environment then file then default precedence', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      cli: { logLevel: 'debug' },
      environment: {
        JOBHUNTER_LOG_LEVEL: 'warn',
        JOBHUNTER_WORKER_POLL_INTERVAL_MS: '2500',
        JOBHUNTER_MODEL_PROVIDER: 'test-provider',
        JOBHUNTER_MODEL_BASE_URL: 'https://models.example.test/v1',
        JOBHUNTER_MODEL_NAME: 'test-model',
        JOBHUNTER_MODEL_API_KEY: 'secret-value',
      },
      file: {
        logLevel: 'error',
        worker: {
          pollIntervalMs: 3000,
          maxConcurrentNetworkTasks: 7,
          taskTypeConcurrency: { 'source.sync': 2 },
        },
      },
    });
    expect(config.logLevel).toEqual({ value: 'debug', source: 'cli' });
    expect(config.worker.pollIntervalMs).toEqual({ value: 2500, source: 'environment' });
    expect(config.worker.maxConcurrentNetworkTasks).toEqual({ value: 7, source: 'file' });
    expect(config.worker.taskTypeConcurrency).toEqual({
      value: { 'source.sync': 2 },
      source: 'file',
    });
    expect(config.model.provider).toEqual({ value: 'test-provider', source: 'environment' });
    expect(config.model.baseUrl.value).toBe('https://models.example.test/v1');
    expect(config.model.modelName.value).toBe('test-model');
    expect(config.model.apiKey.value?.reveal()).toBe('secret-value');
  });

  it('accepts per-task-type concurrency from the environment', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        JOBHUNTER_TASK_TYPE_CONCURRENCY: JSON.stringify({
          'source.sync': 2,
          'match.advise': 4,
        }),
      },
    });
    expect(config.worker.taskTypeConcurrency).toEqual({
      value: { 'source.sync': 2, 'match.advise': 4 },
      source: 'environment',
    });
  });

  it('accepts personal OpenAI-compatible aliases without exposing the secret', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        BASE_URL: 'https://models.example.test/v1',
        MODEL: 'test-model',
        API_KEY: 'local-secret',
      },
    });
    expect(config.model.provider.value).toBe('openai-compatible');
    expect(config.model.baseUrl.value).toBe('https://models.example.test/v1');
    expect(config.model.modelName.value).toBe('test-model');
    expect(JSON.stringify(config.model.apiKey)).not.toContain('local-secret');
  });

  it('rejects bootstrap fields and secrets in the local non-sensitive file', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    expect(() =>
      resolveAppConfig({ bootstrap, environment: {}, file: { dataRoot: './escape' } }),
    ).toThrow();
    expect(() =>
      resolveAppConfig({ bootstrap, environment: {}, file: { model: { apiKey: 'secret' } } }),
    ).toThrow();
  });

  it('redacts secrets during implicit string and JSON conversion', () => {
    const secret = new SecretString('sensitive');
    expect(String(secret)).toBe('[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
  });
});
