import { createLocalCliContainer } from './container.js';
import type { CliIo } from './io.js';
import { cliExitCode, type CliExitCode } from './model.js';
import { runCli } from './program.js';
import { HumanRenderer, JsonRenderer } from './renderer.js';
import { loadRuntimeConfig } from './runtime-config.js';

export async function runLocalCli(input: {
  readonly argv: readonly string[];
  readonly io: CliIo;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}): Promise<CliExitCode> {
  try {
    const config = await loadRuntimeConfig(input);
    return await runCli({
      argv: input.argv,
      container: createLocalCliContainer(config),
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
