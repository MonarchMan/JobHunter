import { resolveAppConfig, resolveBootstrapConfig, type AppConfig } from '@jobhunter/application';
import { readFile } from 'node:fs/promises';

/** 读取命令行选项的下一个参数。 */
function optionValue(argv: readonly string[], name: string): string | undefined {
  const assignment = argv.find((value) => value.startsWith(`${name}=`));
  if (assignment) return assignment.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** 读取可选的 JSON 配置文件，不存在时返回空对象。 */
async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

/** 合并命令行、环境变量和配置文件，生成 CLI 运行配置。 */
export async function loadRuntimeConfig(input: {
  readonly argv: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}): Promise<AppConfig> {
  const dataRoot = optionValue(input.argv, '--data-root');
  const configPath = optionValue(input.argv, '--config');
  const bootstrap = resolveBootstrapConfig({
    cli: { ...(dataRoot ? { dataRoot } : {}), ...(configPath ? { configPath } : {}) },
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });
  return resolveAppConfig({
    bootstrap,
    ...(input.environment ? { environment: input.environment } : {}),
    file: await readOptionalJson(bootstrap.configPath.value),
  });
}
