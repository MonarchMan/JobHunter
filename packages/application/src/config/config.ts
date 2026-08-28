import { resolve } from 'node:path';
import { z } from 'zod';

export type ConfigSource = 'cli' | 'environment' | 'file' | 'default';

export interface SourcedValue<T> {
  readonly value: T;
  readonly source: ConfigSource;
}

/** A secret can only be exposed through an explicit call and serializes as redacted text. */
export class SecretString {
  readonly #value: string;

  public constructor(value: string) {
    if (value.trim().length === 0) throw new TypeError('Secret value must not be empty.');
    this.#value = value;
  }

  public reveal(): string {
    return this.#value;
  }

  public toString(): string {
    return '[REDACTED]';
  }

  public toJSON(): string {
    return '[REDACTED]';
  }
}

export interface BootstrapConfig {
  readonly dataRoot: SourcedValue<string>;
  readonly configPath: SourcedValue<string>;
}

export interface AppConfig {
  readonly bootstrap: BootstrapConfig;
  readonly logLevel: SourcedValue<'debug' | 'info' | 'warn' | 'error'>;
  readonly worker: {
    readonly pollIntervalMs: SourcedValue<number>;
    readonly maxConcurrentNetworkTasks: SourcedValue<number>;
    readonly taskTypeConcurrency: SourcedValue<Readonly<Record<string, number>>>;
  };
  readonly model: {
    readonly provider: SourcedValue<string | null>;
    readonly baseUrl: SourcedValue<string | null>;
    readonly modelName: SourcedValue<string | null>;
    readonly apiKey: SourcedValue<SecretString | null>;
  };
}

export interface ConfigOverrides {
  readonly dataRoot?: string;
  readonly configPath?: string;
  readonly logLevel?: string;
  readonly workerPollIntervalMs?: number;
  readonly maxConcurrentNetworkTasks?: number;
  readonly taskTypeConcurrency?: Readonly<Record<string, number>>;
  readonly modelProvider?: string;
  readonly modelBaseUrl?: string;
  readonly modelName?: string;
  readonly modelApiKey?: string;
}

const localConfigSchema = z
  .object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    worker: z
      .object({
        pollIntervalMs: z.number().int().min(100).max(60_000).optional(),
        maxConcurrentNetworkTasks: z.number().int().min(1).max(32).optional(),
        taskTypeConcurrency: z
          .record(z.string().trim().min(1), z.number().int().min(1).max(32))
          .optional(),
      })
      .strict()
      .optional(),
    model: z
      .object({ provider: z.string().trim().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict();

const defaultTaskTypeConcurrency: Readonly<Record<string, number>> = {
  'source.sync': 3,
  'source.job-detail': 4,
  'source.health-check': 2,
};

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function choose<T>(
  cli: T | undefined,
  environment: T | undefined,
  file: T | undefined,
  fallback: T,
): SourcedValue<T> {
  if (cli !== undefined) return { value: cli, source: 'cli' };
  if (environment !== undefined) return { value: environment, source: 'environment' };
  if (file !== undefined) return { value: file, source: 'file' };
  return { value: fallback, source: 'default' };
}

function environmentInteger(value: string | undefined, name: string): number | undefined {
  const text = nonEmpty(value);
  if (text === undefined) return undefined;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${name} must be an integer.`);
  return parsed;
}

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

export function resolveBootstrapConfig(input: {
  readonly cli?: Pick<ConfigOverrides, 'dataRoot' | 'configPath'>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}): BootstrapConfig {
  const cwd = resolve(/* turbopackIgnore: true */ input.cwd ?? process.cwd());
  const environment = input.environment ?? process.env;
  const dataRootChoice = choose(
    nonEmpty(input.cli?.dataRoot),
    nonEmpty(environment.JOBHUNTER_DATA_ROOT),
    undefined,
    './var',
  );
  const dataRoot = { ...dataRootChoice, value: resolve(cwd, dataRootChoice.value) };
  const configPathChoice = choose(
    nonEmpty(input.cli?.configPath),
    nonEmpty(environment.JOBHUNTER_CONFIG_PATH),
    undefined,
    resolve(dataRoot.value, 'config.json'),
  );
  return {
    dataRoot,
    configPath: { ...configPathChoice, value: resolve(cwd, configPathChoice.value) },
  };
}

export function resolveAppConfig(input: {
  readonly bootstrap: BootstrapConfig;
  readonly cli?: ConfigOverrides;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly file?: unknown;
}): AppConfig {
  const environment = input.environment ?? process.env;
  const file = localConfigSchema.parse(input.file ?? {});
  const logLevel = choose(
    nonEmpty(input.cli?.logLevel),
    nonEmpty(environment.JOBHUNTER_LOG_LEVEL),
    file.logLevel,
    'info',
  );
  const parsedLogLevel = z.enum(['debug', 'info', 'warn', 'error']).parse(logLevel.value);
  const configuredProvider =
    nonEmpty(input.cli?.modelProvider) ??
    nonEmpty(environment.JOBHUNTER_MODEL_PROVIDER) ??
    file.model?.provider;
  const useAnthropicAliases =
    configuredProvider === 'anthropic' ||
    (configuredProvider === undefined &&
      nonEmpty(environment.ANTHROPIC_API_KEY) !== undefined &&
      nonEmpty(environment.ANTHROPIC_MODEL) !== undefined);
  const modelApiKey = choose(
    nonEmpty(input.cli?.modelApiKey),
    nonEmpty(environment.JOBHUNTER_MODEL_API_KEY) ??
      (useAnthropicAliases
        ? nonEmpty(environment.ANTHROPIC_API_KEY)
        : nonEmpty(environment.API_KEY)),
    undefined,
    null,
  );
  const modelBaseUrl = choose(
    nonEmpty(input.cli?.modelBaseUrl),
    nonEmpty(environment.JOBHUNTER_MODEL_BASE_URL) ??
      (useAnthropicAliases
        ? nonEmpty(environment.ANTHROPIC_BASE_URL)
        : nonEmpty(environment.BASE_URL)),
    undefined,
    useAnthropicAliases ? 'https://api.anthropic.com' : null,
  );
  const modelName = choose(
    nonEmpty(input.cli?.modelName),
    nonEmpty(environment.JOBHUNTER_MODEL_NAME) ??
      (useAnthropicAliases ? nonEmpty(environment.ANTHROPIC_MODEL) : nonEmpty(environment.MODEL)),
    undefined,
    null,
  );
  const inferredProvider =
    modelApiKey.value && modelBaseUrl.value && modelName.value
      ? useAnthropicAliases
        ? 'anthropic'
        : 'openai-compatible'
      : null;
  const pollIntervalMs = choose(
    input.cli?.workerPollIntervalMs,
    environmentInteger(environment.JOBHUNTER_WORKER_POLL_INTERVAL_MS, 'poll interval'),
    file.worker?.pollIntervalMs,
    1_000,
  );
  const maxConcurrentNetworkTasks = choose(
    input.cli?.maxConcurrentNetworkTasks,
    environmentInteger(environment.JOBHUNTER_MAX_CONCURRENT_NETWORK_TASKS, 'network concurrency'),
    file.worker?.maxConcurrentNetworkTasks,
    4,
  );
  const taskTypeConcurrency = choose(
    input.cli?.taskTypeConcurrency,
    environmentConcurrency(environment.JOBHUNTER_TASK_TYPE_CONCURRENCY),
    file.worker?.taskTypeConcurrency,
    defaultTaskTypeConcurrency,
  );
  return {
    bootstrap: input.bootstrap,
    logLevel: { ...logLevel, value: parsedLogLevel },
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
      provider: choose(
        nonEmpty(input.cli?.modelProvider),
        nonEmpty(environment.JOBHUNTER_MODEL_PROVIDER),
        file.model?.provider,
        inferredProvider,
      ),
      baseUrl: modelBaseUrl,
      modelName,
      apiKey: {
        source: modelApiKey.source,
        value: modelApiKey.value === null ? null : new SecretString(modelApiKey.value),
      },
    },
  };
}
