import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import {
  resolveAppConfig,
  resolveBootstrapConfig,
  type AppConfig,
  type ConfigOverrides,
} from './config.js';

/** 运行时配置加载参数；工作区根目录同时约束 `.env` 和默认数据目录的位置。 */
export interface RuntimeAppConfigInput {
  readonly workspaceRoot: string;
  readonly cli?: ConfigOverrides;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** 读取可选文本文件；文件不存在表示该层未配置，其他错误必须阻止启动。 */
async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 为 CLI、Web 和 Worker 加载同一份工作区运行时配置。 */
export async function loadRuntimeAppConfig(input: RuntimeAppConfigInput): Promise<AppConfig> {
  const workspaceRoot = resolve(input.workspaceRoot);

  // 1、固定从工作区根目录读取 `.env`；显式进程环境覆盖文件值且不修改全局 process.env。
  const environmentText = await readOptionalText(resolve(workspaceRoot, '.env'));
  const environment = {
    ...(environmentText === null ? {} : parseEnv(environmentText)),
    ...(input.environment ?? process.env),
  };

  // 2、先解析数据与配置文件路径，再读取仅包含非敏感项的本地 JSON 配置。
  const bootstrap = resolveBootstrapConfig({
    cwd: workspaceRoot,
    environment,
    ...(input.cli ? { cli: input.cli } : {}),
  });
  const configText = await readOptionalText(bootstrap.configPath.value);
  const file = configText === null ? {} : (JSON.parse(configText) as unknown);

  // 3、复用唯一优先级规则完成校验，密钥仍由 SecretString 封装后返回。
  return resolveAppConfig({
    bootstrap,
    environment,
    file,
    ...(input.cli ? { cli: input.cli } : {}),
  });
}
