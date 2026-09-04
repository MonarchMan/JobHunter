import { loadRuntimeAppConfig, type AppConfig } from '@jobhunter/application';

/** 读取命令行选项的下一个参数。 */
function optionValue(argv: readonly string[], name: string): string | undefined {
  const assignment = argv.find((value) => value.startsWith(`${name}=`));
  if (assignment) return assignment.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** 合并命令行、环境变量和配置文件，生成 CLI 运行配置。 */
export async function loadRuntimeConfig(input: {
  readonly argv: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly workspaceRoot?: string;
}): Promise<AppConfig> {
  const dataRoot = optionValue(input.argv, '--data-root');
  const configPath = optionValue(input.argv, '--config');
  return loadRuntimeAppConfig({
    workspaceRoot: input.workspaceRoot ?? input.cwd ?? process.cwd(),
    cli: { ...(dataRoot ? { dataRoot } : {}), ...(configPath ? { configPath } : {}) },
    ...(input.environment ? { environment: input.environment } : {}),
  });
}
