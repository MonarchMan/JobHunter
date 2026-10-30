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
    readonly costCurrency: SourcedValue<'USD' | 'CNY'>;
    readonly inputCostPerMillionUsd: SourcedValue<number | null>;
    readonly outputCostPerMillionUsd: SourcedValue<number | null>;
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

/** 统一模型 ID，兼容中转站前缀、路由后缀和大小写差异。 */
export function normalizeModelPricingId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .split('/')
    .at(-1)!
    .split(':')[0]!
    .replaceAll('@', '-')
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/u, '');
}

/** 内置官方公开价种子目录；单位为 USD / 百万 Token。未命中不猜价。 */
const defaultModelPricing: Readonly<Record<string, readonly [number, number]>> = {
  // OpenAI
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  o3: [2, 8],
  'o3-mini': [1.1, 4.4],
  'o4-mini': [1.1, 4.4],
  'claude-opus-4-5': [5, 25],
  'claude-opus-4': [15, 75],
  'claude-sonnet-4': [3, 15],
  'claude-3-7-sonnet': [3, 15],
  'claude-3-5-sonnet': [3, 15],
  'claude-3-5-haiku': [0.8, 4],
  'claude-sonnet-4-5': [3, 15],
  'claude-haiku-4-5': [1, 5],
  'gpt-5.5': [5, 30],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-mini': [0.2, 1.25],
  'deepseek-v4-flash': [1 / 7, 2 / 7],
  'deepseek-v4-pro': [12 / 7, 24 / 7],
  'deepseek-chat': [0.7 / 7, 2.8 / 7],
  'deepseek-reasoner': [4 / 7, 16 / 7],
  'deepseek-v3': [0.7 / 7, 2.8 / 7],
  'deepseek-r1': [4 / 7, 16 / 7],
  'kimi-k2': [4 / 7, 16 / 7],
  'moonshot-v1-8k': [12 / 7, 12 / 7],
  'moonshot-v1-32k': [24 / 7, 24 / 7],
  'moonshot-v1-128k': [60 / 7, 60 / 7],
  'minimax-m2.1': [2.1 / 7, 8.4 / 7],
  'glm-4.7': [2 / 7, 8 / 7],
  'glm-4-plus': [5 / 7, 5 / 7],
  'glm-4-flash': [0.1 / 7, 0.1 / 7],
  'qwen-plus': [0.8 / 7, 2 / 7],
  'qwen-turbo': [0.3 / 7, 0.6 / 7],
  'qwen-max': [2.4 / 7, 9.6 / 7],
  // Z.ai 海外 API 公开价，单位 USD / 百万 Token；BigModel 国内人民币价需显式覆盖。
  'glm-5.3': [1.4, 4.4],
  'glm-5.3-flash': [0.15, 0.5],
  'glm-5.3-flashx': [0.37, 1.25],
};

/** 按标准化模型 ID 选择内置价格；显式环境价格优先于内置目录。 */
function resolveDefaultModelPricing(model: string | null): readonly [number, number] | null {
  if (!model) return null;
  return defaultModelPricing[normalizeModelPricingId(model)] ?? null;
}

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

/** 解析每百万 Token 的美元价格；未配置表示当前模型尚无可用报价。 */
function environmentNonNegativeNumber(value: string | undefined, name: string): number | undefined {
  const text = nonEmpty(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new TypeError(`${name} must be a non-negative number.`);
  return parsed;
}

/** 解析支持的成本货币；价格单位必须与该货币一致，避免混算。 */
function environmentCostCurrency(value: string | undefined): 'USD' | 'CNY' {
  const currency = nonEmpty(value)?.toUpperCase() ?? 'USD';
  if (currency !== 'USD' && currency !== 'CNY')
    throw new TypeError('MODEL_COST_CURRENCY must be USD or CNY.');
  return currency;
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
    nonEmpty(environment.DATA_ROOT),
    './var',
  );
  const dataRoot = { ...dataRootChoice, value: resolve(cwd, dataRootChoice.value) };
  const mailboxConfigPathChoice = choose(
    undefined,
    nonEmpty(environment.MAILBOX_CONFIG_PATH),
    resolve(dataRoot.value, 'mail', 'mailboxes.json'),
  );
  const mailboxCredentialPathChoice = choose(
    undefined,
    nonEmpty(environment.MAILBOX_CREDENTIAL_PATH),
    resolve(dataRoot.value, 'mail', 'credentials.enc.json'),
  );
  const mailboxCredentialKeyPathChoice = choose(
    undefined,
    nonEmpty(environment.MAILBOX_CREDENTIAL_KEY_PATH),
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
  const logLevel = choose(nonEmpty(input.cli?.logLevel), nonEmpty(environment.LOG_LEVEL), 'info');
  const parsedLogLevel = z.enum(['debug', 'info', 'warn', 'error']).parse(logLevel.value);
  const modelApiKey = choose(nonEmpty(input.cli?.modelApiKey), nonEmpty(environment.API_KEY), null);
  const modelBaseUrl = choose(
    nonEmpty(input.cli?.modelBaseUrl),
    nonEmpty(environment.BASE_URL),
    defaultOpenAiBaseUrl,
  );
  const modelName = choose(nonEmpty(input.cli?.modelName), nonEmpty(environment.MODEL), null);
  const costCurrency = choose<'USD' | 'CNY'>(
    undefined,
    environmentCostCurrency(environment.MODEL_COST_CURRENCY),
    'USD',
  );
  const inputCostPerMillionUsd = choose(
    undefined,
    environmentNonNegativeNumber(environment.MODEL_INPUT_COST_PER_MILLION_USD, 'input model price'),
    resolveDefaultModelPricing(modelName.value)?.[0] ?? null,
  );
  const outputCostPerMillionUsd = choose(
    undefined,
    environmentNonNegativeNumber(
      environment.MODEL_OUTPUT_COST_PER_MILLION_USD,
      'output model price',
    ),
    resolveDefaultModelPricing(modelName.value)?.[1] ?? null,
  );
  const inferredProvider = inferModelProvider(modelBaseUrl.value);
  const pollIntervalMs = choose(
    input.cli?.workerPollIntervalMs,
    environmentInteger(environment.WORKER_POLL_INTERVAL_MS, 'poll interval'),
    1_000,
  );
  const maxConcurrentNetworkTasks = choose(
    input.cli?.maxConcurrentNetworkTasks,
    environmentInteger(environment.MAX_CONCURRENT_NETWORK_TASKS, 'network concurrency'),
    4,
  );
  const taskTypeConcurrency = choose(
    input.cli?.taskTypeConcurrency,
    environmentConcurrency(environment.TASK_TYPE_CONCURRENCY),
    defaultTaskTypeConcurrency,
  );
  const requestIntervalMs = choose(
    input.cli?.platformRequestIntervalMs,
    environmentInteger(environment.PLATFORM_REQUEST_INTERVAL_MS, 'platform request interval'),
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
          environment[`PLATFORM_REQUEST_INTERVAL_MS_${suffix}`],
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
    nonEmpty(environment.WEB_BASE_URL),
    'http://127.0.0.1:3210',
  );
  const mailboxCredentialMasterKey = choose(
    undefined,
    nonEmpty(environment.MAILBOX_CREDENTIAL_KEY),
    null,
  );
  const gmailClientId = choose(undefined, nonEmpty(environment.GMAIL_CLIENT_ID), null);
  const gmailClientSecret = choose(undefined, nonEmpty(environment.GMAIL_CLIENT_SECRET), null);
  const microsoftClientId = choose(undefined, nonEmpty(environment.MICROSOFT_CLIENT_ID), null);
  const microsoftClientSecret = choose(
    undefined,
    nonEmpty(environment.MICROSOFT_CLIENT_SECRET),
    null,
  );
  const microsoftTenant = choose(undefined, nonEmpty(environment.MICROSOFT_TENANT), 'common');
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
      costCurrency: { source: 'environment', value: costCurrency.value },
      inputCostPerMillionUsd,
      outputCostPerMillionUsd,
    },
    mail: {
      classification: {
        modelMode: choose(
          undefined,
          nonEmpty(environment.MAIL_MODEL_MODE) === undefined
            ? undefined
            : z.enum(['off', 'configured']).parse(environment.MAIL_MODEL_MODE?.trim()),
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
