import { resolve } from 'node:path';
import { z } from 'zod';
import type { PlatformProviderKey } from '@jobhunter/platform-core';

/** 应用层使用的类型约束。 */
export type ConfigSource = 'cli' | 'environment' | 'default';

/** 应用层数据结构或端口契约。 */
export interface SourcedValue<T> {
  readonly value: T;
  readonly source: ConfigSource;
}

/** 根据模型 Base URL 推断出的传输协议类型。 */
export type ModelProvider = 'openai-compatible' | 'anthropic';

/** A secret can only be exposed through an explicit call and serializes as redacted text. */
/** 防止密钥在日志、JSON 和字符串插值中意外泄露。 */
export class SecretString {
  readonly #value: string;

  public constructor(value: string) {
    if (value.trim().length === 0) throw new TypeError('Secret value must not be empty.');
    this.#value = value;
  }

  /** 在确需调用外部客户端时显式取出密钥。 */
  public reveal(): string {
    return this.#value;
  }

  public toString(): string {
    return '[REDACTED]';
  }

  /** 执行应用组件对外暴露的操作。 */
  public toJSON(): string {
    return '[REDACTED]';
  }
}

/** 应用层数据结构或端口契约。 */
export interface BootstrapConfig {
  readonly dataRoot: SourcedValue<string>;
  readonly mailboxConfigPath: SourcedValue<string>;
  readonly mailboxCredentialPath: SourcedValue<string>;
  readonly mailboxCredentialKeyPath: SourcedValue<string>;
}

/** 应用层数据结构或端口契约。 */
export interface AppConfig {
  readonly bootstrap: BootstrapConfig;
  readonly logLevel: SourcedValue<'debug' | 'info' | 'warn' | 'error'>;
  readonly platforms: {
    readonly requestIntervalMs: SourcedValue<number>;
    readonly requestIntervalMsByProvider: SourcedValue<
      Readonly<Partial<Record<PlatformProviderKey, number | undefined>>>
    >;
  };
  readonly worker: {
    readonly pollIntervalMs: SourcedValue<number>;
    readonly maxConcurrentNetworkTasks: SourcedValue<number>;
    readonly taskTypeConcurrency: SourcedValue<Readonly<Record<string, number>>>;
  };
  readonly model: {
    readonly provider: SourcedValue<ModelProvider>;
    readonly baseUrl: SourcedValue<string>;
    readonly modelName: SourcedValue<string | null>;
    readonly apiKey: SourcedValue<SecretString | null>;
  };
  readonly mail: {
    readonly classification: {
      readonly modelMode: SourcedValue<'off' | 'configured'>;
    };
    readonly webBaseUrl: SourcedValue<string>;
    readonly credentialMasterKey: SourcedValue<SecretString | null>;
    readonly gmail: {
      readonly clientId: SourcedValue<string | null>;
      readonly clientSecret: SourcedValue<SecretString | null>;
    };
    readonly microsoftGraph: {
      readonly clientId: SourcedValue<string | null>;
      readonly clientSecret: SourcedValue<SecretString | null>;
      readonly tenant: SourcedValue<string>;
    };
  };
}

/** 应用层数据结构或端口契约。 */
export interface ConfigOverrides {
  readonly dataRoot?: string;
  readonly logLevel?: string;
  readonly platformRequestIntervalMs?: number;
  readonly workerPollIntervalMs?: number;
  readonly maxConcurrentNetworkTasks?: number;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
  readonly modelBaseUrl?: string;
  readonly modelName?: string;
  readonly modelApiKey?: string;
}

const defaultOpenAiBaseUrl = 'https://api.openai.com/v1';

const defaultTaskTypeConcurrency: Readonly<Record<string, number>> = {
  'source.sync': 3,
  'source.job-detail': 4,
  'source.health-check': 2,
};

/** 将空字符串配置归一化为未设置。 */
function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

/** 按命令行、环境和内置默认值顺序选择配置。 */
function choose<T>(cli: T | undefined, environment: T | undefined, fallback: T): SourcedValue<T> {
  if (cli !== undefined) return { value: cli, source: 'cli' };
  if (environment !== undefined) return { value: environment, source: 'environment' };
  return { value: fallback, source: 'default' };
}

/** 解析并校验环境变量中的非负整数。 */
function environmentInteger(value: string | undefined, name: string): number | undefined {
  const text = nonEmpty(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${name} must be an integer.`);
  return parsed;
}

/** 执行应用层的解析、转换或编排辅助逻辑。 */
function environmentConcurrency(
  value: string | undefined,
): Readonly<Record<string, number>> | undefined {
  const text = nonEmpty(value);
  if (text === undefined) return undefined;
  try {
    return z
      .record(z.string().trim().min(1), z.number().int().min(1).max(32))
      .parse(JSON.parse(text));
  } catch (error) {
    throw new TypeError(
      'task type concurrency must be a JSON object with integer values from 1 to 32.',
      { cause: error },
    );
  }
}

/** 根据标准化 Base URL 自动选择模型协议，避免用户重复声明 Provider。 */
function inferModelProvider(baseUrl: string): ModelProvider {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new TypeError('model base URL must be a valid absolute URL.', { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('model base URL must use HTTP or HTTPS.');
  }

  // 1. 官方域名和带 anthropic 独立主机标签的网关使用 Anthropic Messages 协议。
  const hostLabels = parsed.hostname.toLowerCase().split('.');
  if (hostLabels.includes('anthropic')) return 'anthropic';

  // 2. 通用代理可通过独立 `/anthropic/` 路径段声明协议，其余地址统一视为 OpenAI 兼容接口。
  const pathSegments = parsed.pathname
    .toLowerCase()
    .split('/')
    .filter((segment) => segment.length > 0);
  return pathSegments.includes('anthropic') ? 'anthropic' : 'openai-compatible';
}

/** 校验 Web 对外基址，OAuth 回调只能使用 HTTP(S) 且不包含查询参数或片段。 */
function normalizeWebBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('web base URL must use HTTP or HTTPS.');
  }
  if (url.search || url.hash) throw new TypeError('web base URL must not contain query or hash.');
  return url.toString().replace(/\/$/, '');
}

/** 解析启动阶段数据目录和邮箱运行数据路径。 */
export function resolveBootstrapConfig(input: {
  readonly cli?: Pick<ConfigOverrides, 'dataRoot'>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}): BootstrapConfig {
  const cwd = resolve(/* turbopackIgnore: true */ input.cwd ?? process.cwd());
  const environment = input.environment ?? process.env;
  const dataRootChoice = choose(
    nonEmpty(input.cli?.dataRoot),
    nonEmpty(environment.JOBHUNTER_DATA_ROOT),
    './var',
  );
  const dataRoot = { ...dataRootChoice, value: resolve(cwd, dataRootChoice.value) };
  const mailboxConfigPathChoice = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MAILBOX_CONFIG_PATH),
    resolve(dataRoot.value, 'mail', 'mailboxes.json'),
  );
  const mailboxCredentialPathChoice = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MAILBOX_CREDENTIAL_PATH),
    resolve(dataRoot.value, 'mail', 'credentials.enc.json'),
  );
  const mailboxCredentialKeyPathChoice = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MAILBOX_CREDENTIAL_KEY_PATH),
    resolve(dataRoot.value, 'mail', 'credentials.key'),
  );
  return {
    dataRoot,
    mailboxConfigPath: {
      ...mailboxConfigPathChoice,
      value: resolve(cwd, mailboxConfigPathChoice.value),
    },
    mailboxCredentialPath: {
      ...mailboxCredentialPathChoice,
      value: resolve(cwd, mailboxCredentialPathChoice.value),
    },
    mailboxCredentialKeyPath: {
      ...mailboxCredentialKeyPathChoice,
      value: resolve(cwd, mailboxCredentialKeyPathChoice.value),
    },
  };
}

/** 合并 CLI、环境和默认值，生成最终应用配置。 */
export function resolveAppConfig(input: {
  // 1、应用命令行和环境配置；2、解析并校验并发和模型参数；3、返回来源标记。
  readonly bootstrap: BootstrapConfig;
  readonly cli?: ConfigOverrides;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): AppConfig {
  const environment = input.environment ?? process.env;
  const logLevel = choose(
    nonEmpty(input.cli?.logLevel),
    nonEmpty(environment.JOBHUNTER_LOG_LEVEL),
    'info',
  );
  const parsedLogLevel = z.enum(['debug', 'info', 'warn', 'error']).parse(logLevel.value);
  const modelApiKey = choose(nonEmpty(input.cli?.modelApiKey), nonEmpty(environment.API_KEY), null);
  const modelBaseUrl = choose(
    nonEmpty(input.cli?.modelBaseUrl),
    nonEmpty(environment.BASE_URL),
    defaultOpenAiBaseUrl,
  );
  const modelName = choose(nonEmpty(input.cli?.modelName), nonEmpty(environment.MODEL), null);
  const inferredProvider = inferModelProvider(modelBaseUrl.value);
  const pollIntervalMs = choose(
    input.cli?.workerPollIntervalMs,
    environmentInteger(environment.JOBHUNTER_WORKER_POLL_INTERVAL_MS, 'poll interval'),
    1_000,
  );
  const maxConcurrentNetworkTasks = choose(
    input.cli?.maxConcurrentNetworkTasks,
    environmentInteger(environment.JOBHUNTER_MAX_CONCURRENT_NETWORK_TASKS, 'network concurrency'),
    4,
  );
  const taskTypeConcurrency = choose(
    input.cli?.taskTypeConcurrency,
    environmentConcurrency(environment.JOBHUNTER_TASK_TYPE_CONCURRENCY),
    defaultTaskTypeConcurrency,
  );
  const requestIntervalMs = choose(
    input.cli?.platformRequestIntervalMs,
    environmentInteger(
      environment.JOBHUNTER_PLATFORM_REQUEST_INTERVAL_MS,
      'platform request interval',
    ),
    0,
  );
  const requestIntervalMsByProviderRecord = Object.fromEntries(
    (
      [
        ['boss', 'BOSS'],
        ['zhilian', 'ZHILIAN'],
        ['51job', '51JOB'],
        ['liepin', 'LIEPIN'],
      ] as const satisfies readonly (readonly [PlatformProviderKey, string])[]
    )
      .map(([provider, suffix]) => {
        const interval = environmentInteger(
          environment[`JOBHUNTER_PLATFORM_REQUEST_INTERVAL_MS_${suffix}`],
          `${provider} platform request interval`,
        );
        return interval === undefined
          ? null
          : [provider, z.number().int().min(0).max(60_000).parse(interval)];
      })
      .filter((entry) => entry !== null),
  ) as Partial<Record<PlatformProviderKey, number>>;
  const requestIntervalMsByProvider: SourcedValue<
    Readonly<Partial<Record<PlatformProviderKey, number | undefined>>>
  > = {
    value: requestIntervalMsByProviderRecord,
    source: Object.keys(requestIntervalMsByProviderRecord).length > 0 ? 'environment' : 'default',
  };
  const mailWebBaseUrl = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_WEB_BASE_URL),
    'http://127.0.0.1:3210',
  );
  const mailboxCredentialMasterKey = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MAILBOX_CREDENTIAL_KEY),
    null,
  );
  const gmailClientId = choose(undefined, nonEmpty(environment.JOBHUNTER_GMAIL_CLIENT_ID), null);
  const gmailClientSecret = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_GMAIL_CLIENT_SECRET),
    null,
  );
  const microsoftClientId = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MICROSOFT_CLIENT_ID),
    null,
  );
  const microsoftClientSecret = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MICROSOFT_CLIENT_SECRET),
    null,
  );
  const microsoftTenant = choose(
    undefined,
    nonEmpty(environment.JOBHUNTER_MICROSOFT_TENANT),
    'common',
  );
  return {
    bootstrap: input.bootstrap,
    logLevel: { ...logLevel, value: parsedLogLevel },
    platforms: {
      requestIntervalMs: {
        ...requestIntervalMs,
        value: z.number().int().min(0).max(60_000).parse(requestIntervalMs.value),
      },
      requestIntervalMsByProvider,
    },
    worker: {
      pollIntervalMs: {
        ...pollIntervalMs,
        value: z.number().int().min(100).max(60_000).parse(pollIntervalMs.value),
      },
      maxConcurrentNetworkTasks: {
        ...maxConcurrentNetworkTasks,
        value: z.number().int().min(1).max(32).parse(maxConcurrentNetworkTasks.value),
      },
      taskTypeConcurrency,
    },
    model: {
      provider: { value: inferredProvider, source: modelBaseUrl.source },
      baseUrl: modelBaseUrl,
      modelName,
      apiKey: {
        source: modelApiKey.source,
        value: modelApiKey.value === null ? null : new SecretString(modelApiKey.value),
      },
    },
    mail: {
      classification: {
        modelMode: choose(
          undefined,
          nonEmpty(environment.JOBHUNTER_MAIL_MODEL_MODE) === undefined
            ? undefined
            : z.enum(['off', 'configured']).parse(environment.JOBHUNTER_MAIL_MODEL_MODE?.trim()),
          'off',
        ),
      },
      webBaseUrl: { ...mailWebBaseUrl, value: normalizeWebBaseUrl(mailWebBaseUrl.value) },
      credentialMasterKey: {
        source: mailboxCredentialMasterKey.source,
        value:
          mailboxCredentialMasterKey.value === null
            ? null
            : new SecretString(mailboxCredentialMasterKey.value),
      },
      gmail: {
        clientId: gmailClientId,
        clientSecret: {
          source: gmailClientSecret.source,
          value:
            gmailClientSecret.value === null ? null : new SecretString(gmailClientSecret.value),
        },
      },
      microsoftGraph: {
        clientId: microsoftClientId,
        clientSecret: {
          source: microsoftClientSecret.source,
          value:
            microsoftClientSecret.value === null
              ? null
              : new SecretString(microsoftClientSecret.value),
        },
        tenant: microsoftTenant,
      },
    },
  };
}
