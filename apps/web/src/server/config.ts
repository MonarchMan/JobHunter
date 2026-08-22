import {
  resolveAppConfig,
  resolveBootstrapConfig,
  type AppConfig,
} from '@jobhunter/application/web';
import { readFile } from 'node:fs/promises';

async function readOptionalJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function loadWebRuntimeConfig(
  input: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly cwd?: string;
  } = {},
): Promise<AppConfig> {
  const bootstrap = resolveBootstrapConfig({
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });
  return resolveAppConfig({
    bootstrap,
    ...(input.environment ? { environment: input.environment } : {}),
    file: await readOptionalJson(bootstrap.configPath.value),
  });
}
