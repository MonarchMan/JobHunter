import { createLocalCliContainer } from './container.js';
import type { CliIo } from './io.js';
import { cliExitCode, type CliExitCode } from './model.js';
import { runCli } from './program.js';
import { HumanRenderer, JsonRenderer } from './renderer.js';
import { loadRuntimeConfig } from './runtime-config.js';

/** 装配本地 CLI 容器并执行命令，统一渲染配置错误。 */
export async function runLocalCli(input: {
  readonly argv: readonly string[];
  readonly io: CliIo;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly workspaceRoot?: string;
}): Promise<CliExitCode> {
  try {
    const config = await loadRuntimeConfig(input);
    return await runCli({
      argv: input.argv,
      container: createLocalCliContainer(config, {
        ...(input.workspaceRoot || input.cwd
          ? { workspaceRoot: input.workspaceRoot ?? input.cwd }
          : {}),
      }),
      io: input.io,
    });
  } catch {
    const error = { code: 'CONFIGURATION_ERROR', message: '配置文件或启动参数无效。', details: {} };
    const renderer = input.argv.includes('--json')
      ? new JsonRenderer(input.io)
      : new HumanRenderer(input.io);
    renderer.failure(error);
    return cliExitCode.usage;
  }
}
