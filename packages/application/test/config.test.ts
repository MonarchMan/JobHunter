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

describe('workspace dotenv configuration', () => {
  it('requires explicit mail model consent', () => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    expect(resolveAppConfig({ bootstrap, environment: {} }).mail.classification.modelMode).toEqual({
      value: 'off',
      source: 'default',
    });
    expect(
      resolveAppConfig({ bootstrap, environment: { JOBHUNTER_MAIL_MODEL_MODE: 'configured' } }).mail
        .classification.modelMode,
    ).toEqual({ value: 'configured', source: 'environment' });
    expect(() =>
      resolveAppConfig({ bootstrap, environment: { JOBHUNTER_MAIL_MODEL_MODE: 'invalid' } }),
    ).toThrow();
  });

  it('applies CLI, environment, then default precedence', () => {
    const bootstrap = resolveBootstrapConfig({ cwd: 'C:/workspace', environment: {} });
    const config = resolveAppConfig({
      bootstrap,
      cli: { logLevel: 'debug' },
      environment: {
        JOBHUNTER_LOG_LEVEL: 'warn',
        JOBHUNTER_WORKER_POLL_INTERVAL_MS: '2500',
        JOBHUNTER_MAX_CONCURRENT_NETWORK_TASKS: '7',
        JOBHUNTER_TASK_TYPE_CONCURRENCY: '{"source.sync":2}',
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
          JOBHUNTER_PLATFORM_REQUEST_INTERVAL_MS_BOSS: '0',
          JOBHUNTER_PLATFORM_REQUEST_INTERVAL_MS_LIEPIN: '1000',
        },
      }).platforms.requestIntervalMsByProvider,
    ).toEqual({ value: { boss: 0, liepin: 1000 }, source: 'environment' });
  });

  it.each(['-1', '1.5', '60001', 'invalid'])('rejects invalid platform interval %s', (value) => {
    const bootstrap = resolveBootstrapConfig({ environment: {} });
    expect(() =>
      resolveAppConfig({
        bootstrap,
        environment: { JOBHUNTER_PLATFORM_REQUEST_INTERVAL_MS_LIEPIN: value },
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
      environment: { JOBHUNTER_MAILBOX_CONFIG_PATH: './private/mailboxes.json' },
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
          'JOBHUNTER_DATA_ROOT=./runtime-data',
          'JOBHUNTER_LOG_LEVEL=error',
          'JOBHUNTER_WORKER_POLL_INTERVAL_MS=2000',
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
        JOBHUNTER_MAILBOX_CREDENTIAL_PATH: './private/credentials.enc.json',
        JOBHUNTER_MAILBOX_CREDENTIAL_KEY_PATH: './private/credentials.key',
      },
    });
    const config = resolveAppConfig({
      bootstrap,
      environment: { JOBHUNTER_MAILBOX_CREDENTIAL_KEY: 'credential-master-key' },
    });
    expect(config.mail.credentialMasterKey.value?.reveal()).toBe('credential-master-key');
    expect(JSON.stringify(config.mail.credentialMasterKey)).not.toContain('credential-master-key');
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
        JOBHUNTER_WEB_BASE_URL: 'http://127.0.0.1:4321/',
        JOBHUNTER_GMAIL_CLIENT_ID: 'gmail-client',
        JOBHUNTER_GMAIL_CLIENT_SECRET: 'gmail-secret',
        JOBHUNTER_MICROSOFT_CLIENT_ID: 'microsoft-client',
        JOBHUNTER_MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
        JOBHUNTER_MICROSOFT_TENANT: 'organizations',
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
