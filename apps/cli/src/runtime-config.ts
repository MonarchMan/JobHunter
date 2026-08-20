import { resolveAppConfig, resolveBootstrapConfig, type AppConfig } from '@jobhunter/application';
import { readFile } from 'node:fs/promises';

function optionValue(argv: readonly string[], name: string): string | undefined {
  const assignment = argv.find((value) => value.startsWith(`${name}=`));
  if (assignment) return assignment.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function readOptionalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

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
