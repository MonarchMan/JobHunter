import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadRuntimeAppConfig,
  resolveAppConfig,
  resolveBootstrapConfig,
  SecretString,
} from '../src/index.js';

describe('two-stage configuration', () => {
  it('loads workspace environment consistently and lets process values override it', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'jobhunter-runtime-config-'));
    try {
      // 1、准备工作区级 `.env` 与非敏感配置，模拟从任意应用子目录启动。
      await writeFile(
        join(workspaceRoot, '.env'),
        [
          'JOBHUNTER_DATA_ROOT=./runtime-data',
          'BASE_URL=https://workspace-model.example.test/v1',
          'MODEL=workspace-model',
          'API_KEY=workspace-secret',
        ].join('\n'),
        'utf8',
      );
      await mkdir(join(workspaceRoot, 'runtime-data'));
      await writeFile(
        join(workspaceRoot, 'runtime-data', 'config.json'),
        JSON.stringify({ logLevel: 'error' }),
        'utf8',
      );

      // 2、显式进程环境覆盖 `.env` 同名模型名，其他模型字段继续来自工作区文件。
      const config = await loadRuntimeAppConfig({
        workspaceRoot,
        environment: { MODEL: 'process-model' },
      });

      // 3、配置路径只相对工作区解析，密钥仍保持脱敏包装。
      expect(config.bootstrap.dataRoot.value).toBe(join(workspaceRoot, 'runtime-data'));
      expect(config.model.provider.value).toBe('openai-compatible');
      expect(config.model.baseUrl.value).toBe('https://workspace-model.example.test/v1');
      expect(config.model.modelName).toEqual({ value: 'process-model', source: 'environment' });
      expect(config.model.apiKey.value?.reveal()).toBe('workspace-secret');
      expect(JSON.stringify(config.model.apiKey)).not.toContain('workspace-secret');
      expect(config.logLevel).toEqual({ value: 'error', source: 'file' });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

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

  it('uses bounded I/O task concurrency defaults', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({ bootstrap, environment: {} });
    expect(config.worker.taskTypeConcurrency).toEqual({
      source: 'default',
      value: {
        'source.sync': 3,
        'source.job-detail': 4,
        'source.health-check': 2,
      },
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

  it('infers Anthropic from its local aliases and supplies the official base URL', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        ANTHROPIC_API_KEY: 'anthropic-secret',
        ANTHROPIC_MODEL: 'claude-test',
      },
    });
    expect(config.model.provider.value).toBe('anthropic');
    expect(config.model.baseUrl.value).toBe('https://api.anthropic.com');
    expect(config.model.modelName.value).toBe('claude-test');
    expect(config.model.apiKey.value?.reveal()).toBe('anthropic-secret');
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
