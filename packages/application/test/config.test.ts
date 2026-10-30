import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadRuntimeAppConfig,
  resolveAppConfig,
  resolveBootstrapConfig,
  normalizeModelPricingId,
  SecretString,
} from '../src/index.js';

describe('workspace dotenv configuration', () => {
  it('normalizes model IDs and applies explicit pricing overrides', () => {
    expect(normalizeModelPricingId('OpenAI/gpt-5.4:free')).toBe('gpt-5.4');
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        MODEL: 'OpenAI/gpt-5.4',
        BASE_URL: 'https://models.example.test/v1',
        API_KEY: 'secret-value',
      },
    });
    expect(config.model.inputCostPerMillionUsd.value).toBe(2.5);
    expect(config.model.outputCostPerMillionUsd.value).toBe(15);
    const overridden = resolveAppConfig({
      bootstrap,
      environment: {
        MODEL: 'OpenAI/gpt-5.4',
        BASE_URL: 'https://models.example.test/v1',
        API_KEY: 'secret-value',
        MODEL_INPUT_COST_PER_MILLION_USD: '9',
        MODEL_OUTPUT_COST_PER_MILLION_USD: '19',
      },
    });
    expect(overridden.model.inputCostPerMillionUsd.value).toBe(9);
    expect(overridden.model.outputCostPerMillionUsd.value).toBe(19);
  });

  it('uses the official Z.ai USD catalog for GLM-5.3-Flash', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        MODEL: 'ZHIPU/GLM-5.3-Flash',
        BASE_URL: 'https://models.example.test/v1',
        API_KEY: 'secret-value',
      },
    });
    expect(config.model.inputCostPerMillionUsd.value).toBe(0.15);
    expect(config.model.outputCostPerMillionUsd.value).toBe(0.5);
  });

  it('uses the official Z.ai USD catalog for GLM-5.3-FlashX', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        MODEL: 'ZHIPU/GLM-5.3-FlashX',
        BASE_URL: 'https://models.example.test/v1',
        API_KEY: 'secret-value',
      },
    });
    expect(config.model.inputCostPerMillionUsd.value).toBe(0.37);
    expect(config.model.outputCostPerMillionUsd.value).toBe(1.25);
  });

  it.each([
    ['OpenAI/gpt-4o-mini', 0.15, 0.6],
    ['anthropic/claude-3-5-sonnet-20241022', 3, 15],
    ['deepseek/deepseek-chat', 0.7 / 7, 2.8 / 7],
  ])('uses the built-in seed price for %s', (model, inputPrice, outputPrice) => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        MODEL: model,
        BASE_URL: 'https://models.example.test/v1',
        API_KEY: 'secret-value',
      },
    });
    expect(config.model.inputCostPerMillionUsd.value).toBe(inputPrice);
    expect(config.model.outputCostPerMillionUsd.value).toBe(outputPrice);
  });

  it('requires explicit mail model consent', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    expect(resolveAppConfig({ bootstrap, environment: {} }).mail.classification.modelMode).toEqual({
      value: 'off',
      source: 'default',
    });
    expect(
      resolveAppConfig({ bootstrap, environment: { MAIL_MODEL_MODE: 'configured' } }).mail
        .classification.modelMode,
    ).toEqual({ value: 'configured', source: 'environment' });
    expect(() =>
      resolveAppConfig({ bootstrap, environment: { MAIL_MODEL_MODE: 'invalid' } }),
    ).toThrow();
  });

  it('applies CLI, environment, then default precedence', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      cli: { logLevel: 'debug' },
      environment: {
        LOG_LEVEL: 'warn',
        WORKER_POLL_INTERVAL_MS: '2500',
        MAX_CONCURRENT_NETWORK_TASKS: '7',
        TASK_TYPE_CONCURRENCY: '{"source.sync":2}',
        BASE_URL: 'https://models.example.test/v1',
        MODEL: 'test-model',
        API_KEY: 'secret-value',
      },
    });
    expect(config.logLevel).toEqual({ value: 'debug', source: 'cli' });
    expect(config.worker.pollIntervalMs).toEqual({ value: 2500, source: 'environment' });
    expect(config.worker.maxConcurrentNetworkTasks).toEqual({ value: 7, source: 'environment' });
    expect(config.worker.taskTypeConcurrency).toEqual({
      value: { 'source.sync': 2 },
      source: 'environment',
    });
    expect(config.model.provider).toEqual({ value: 'openai-compatible', source: 'environment' });
    expect(config.model.apiKey.value?.reveal()).toBe('secret-value');
  });

  it('maps provider-specific platform intervals from environment variables', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    expect(
      resolveAppConfig({ bootstrap, environment: {} }).platforms.requestIntervalMsByProvider,
    ).toEqual({ value: {}, source: 'default' });
    expect(
      resolveAppConfig({
        bootstrap,
        environment: {
          PLATFORM_REQUEST_INTERVAL_MS_BOSS: '0',
          PLATFORM_REQUEST_INTERVAL_MS_LIEPIN: '1000',
        },
      }).platforms.requestIntervalMsByProvider,
    ).toEqual({ value: { boss: 0, liepin: 1000 }, source: 'environment' });
  });

  it.each(['-1', '1.5', '60001', 'invalid'])('rejects invalid platform interval %s', (value) => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    expect(() =>
      resolveAppConfig({
        bootstrap,
        environment: { PLATFORM_REQUEST_INTERVAL_MS_LIEPIN: value },
      }),
    ).toThrow();
  });

  it('resolves bootstrap paths without a JSON runtime config', () => {
    const bootstrap = resolveBootstrapConfig({
      cwd: 'C:/workspace',
      cli: { dataRoot: './cli-data' },
      environment: { JOBHUNTER_CONFIG_PATH: './ignored-config.json' },
    });
    expect(bootstrap).toEqual({
      dataRoot: { value: resolve('C:/workspace', 'cli-data'), source: 'cli' },
      mailboxConfigPath: {
        value: resolve('C:/workspace', 'cli-data', 'mail', 'mailboxes.json'),
        source: 'default',
      },
      mailboxCredentialPath: {
        value: resolve('C:/workspace', 'cli-data', 'mail', 'credentials.enc.json'),
        source: 'default',
      },
      mailboxCredentialKeyPath: {
        value: resolve('C:/workspace', 'cli-data', 'mail', 'credentials.key'),
        source: 'default',
      },
    });
  });

  it('keeps mailbox storage paths configurable through environment', () => {
    const bootstrap = resolveBootstrapConfig({
      cwd: 'C:/workspace',
      environment: { MAILBOX_CONFIG_PATH: './private/mailboxes.json' },
    });
    expect(bootstrap.mailboxConfigPath).toEqual({
      value: resolve('C:/workspace', 'private/mailboxes.json'),
      source: 'environment',
    });
  });

  it('loads only workspace dotenv and lets process values override it', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'jobhunter-runtime-config-'));
    try {
      // 1、写入工作区 `.env`，并创建旧 JSON 文件验证它不会被读取。
      await writeFile(
        join(workspaceRoot, '.env'),
        [
          'DATA_ROOT=./runtime-data',
          'LOG_LEVEL=error',
          'WORKER_POLL_INTERVAL_MS=2000',
          'BASE_URL=https://workspace-model.example.test/v1',
          'MODEL=workspace-model',
          'API_KEY=workspace-secret',
        ].join('\n'),
        'utf8',
      );
      await mkdir(join(workspaceRoot, 'runtime-data'));
      await writeFile(
        join(workspaceRoot, 'runtime-data', 'config.json'),
        '{"logLevel":"debug"}',
        'utf8',
      );
      // 2、进程环境覆盖 `.env` 的模型名，普通参数继续来自 `.env`。
      const config = await loadRuntimeAppConfig({
        workspaceRoot,
        environment: { MODEL: 'process-model' },
      });
      // 3、旧 JSON 不参与解析，密钥仍保持脱敏包装。
      expect(config.bootstrap.dataRoot.value).toBe(join(workspaceRoot, 'runtime-data'));
      expect(config.logLevel).toEqual({ value: 'error', source: 'environment' });
      expect(config.worker.pollIntervalMs).toEqual({ value: 2000, source: 'environment' });
      expect(config.model.modelName).toEqual({ value: 'process-model', source: 'environment' });
      expect(config.model.apiKey.value?.reveal()).toBe('workspace-secret');
      expect(JSON.stringify(config.model.apiKey)).not.toContain('workspace-secret');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('configures encrypted mailbox credential files and redacts the optional master key', () => {
    const bootstrap = resolveBootstrapConfig({
      cwd: 'C:/workspace',
      environment: {
        MAILBOX_CREDENTIAL_PATH: './private/credentials.enc.json',
        MAILBOX_CREDENTIAL_KEY_PATH: './private/credentials.key',
      },
    });
    const config = resolveAppConfig({
      bootstrap,
      environment: { MAILBOX_CREDENTIAL_KEY: 'credential-master-key' },
    });
    expect(config.mail.credentialMasterKey.value?.reveal()).toBe('credential-master-key');
    expect(JSON.stringify(config.mail.credentialMasterKey)).not.toContain('credential-master-key');
  });

  it('accepts per-task-type concurrency from the environment', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        TASK_TYPE_CONCURRENCY: JSON.stringify({
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

  it('uses the unified model variables without exposing the secret', () => {
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

  it('loads OAuth clients only from the environment and redacts their secrets', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      environment: {
        WEB_BASE_URL: 'http://127.0.0.1:4321/',
        GMAIL_CLIENT_ID: 'gmail-client',
        GMAIL_CLIENT_SECRET: 'gmail-secret',
        MICROSOFT_CLIENT_ID: 'microsoft-client',
        MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
        MICROSOFT_TENANT: 'organizations',
      },
    });

    expect(config.mail.webBaseUrl.value).toBe('http://127.0.0.1:4321');
    expect(config.mail.gmail.clientId.value).toBe('gmail-client');
    expect(config.mail.gmail.clientSecret.value?.reveal()).toBe('gmail-secret');
    expect(config.mail.microsoftGraph.clientId.value).toBe('microsoft-client');
    expect(config.mail.microsoftGraph.clientSecret.value?.reveal()).toBe('microsoft-secret');
    expect(config.mail.microsoftGraph.tenant.value).toBe('organizations');
    expect(JSON.stringify(config.mail)).not.toContain('gmail-secret');
    expect(JSON.stringify(config.mail)).not.toContain('microsoft-secret');
  });

  it.each(['https://api.anthropic.com', 'https://gateway.example.test/anthropic'])(
    'infers Anthropic from base URL %s',
    (baseUrl) => {
      const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
      const config = resolveAppConfig({
        bootstrap,
        environment: {
          BASE_URL: baseUrl,
          API_KEY: 'anthropic-secret',
          MODEL: 'claude-test',
        },
      });
      expect(config.model.provider.value).toBe('anthropic');
      expect(config.model.baseUrl.value).toBe(baseUrl);
      expect(config.model.modelName.value).toBe('claude-test');
      expect(config.model.apiKey.value?.reveal()).toBe('anthropic-secret');
    },
  );

  it('defaults the base URL and provider to OpenAI while leaving credentials optional', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({ bootstrap, environment: {} });
    expect(config.model.provider).toEqual({ value: 'openai-compatible', source: 'default' });
    expect(config.model.baseUrl).toEqual({
      value: 'https://api.openai.com/v1',
      source: 'default',
    });
    expect(config.model.modelName.value).toBeNull();
    expect(config.model.apiKey.value).toBeNull();
  });

  it('redacts secrets during implicit string and JSON conversion', () => {
    const secret = new SecretString('sensitive');
    expect(String(secret)).toBe('[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
  });
});
