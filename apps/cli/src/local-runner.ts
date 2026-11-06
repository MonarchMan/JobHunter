import {
  acquireTaskServiceLock,
  readTaskHostOwner,
  withTaskServiceOwnership,
} from '@jobhunter/common/task-host-runtime';
import { createLocalCliContainer } from './container.js';
import type { CliIo } from './io.js';
import { CliError, cliExitCode, type CliExitCode } from './model.js';
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
    // 1、只识别命令位置的 version，不能把文件名或来源名 version 当作绕过所有权的理由。
    let command: string | undefined;
    for (let index = 0; index < input.argv.length; index++) {
      const argument = input.argv[index];
      if (argument === '--data-root') {
        index++;
        continue;
      }
      if (argument === '--json' || argument?.startsWith('--data-root=')) continue;
      command = argument;
      break;
    }
    const lightweight =
      input.argv.includes('--help') ||
      input.argv.includes('--version') ||
      input.argv.includes('-h') ||
      input.argv.includes('-V') ||
      command === 'version' ||
      input.argv.length === 0;
    const release = lightweight
      ? () => undefined
      : acquireTaskServiceLock(config.bootstrap.dataRoot.value, 'cli');
    if (!release) {
      const owner = readTaskHostOwner(config.bootstrap.dataRoot.value);
      throw new CliError({
        code: 'HOST_ALREADY_RUNNING',
        details: { owner },
        message:
          '同一数据目录已有 Web/CLI 或旧任务服务运行，请先停止原入口。' +
          (owner ? `（${owner.kind}，PID ${String(owner.pid)}，启动于 ${owner.startedAt}）` : ''),
        exitCode: cliExitCode.usage,
      });
    }
    try {
      return await withTaskServiceOwnership(config.bootstrap.dataRoot.value, () =>
        runCli({
          argv: input.argv,
          container: createLocalCliContainer(config, {
            ...(input.workspaceRoot || input.cwd
              ? { workspaceRoot: input.workspaceRoot ?? input.cwd }
              : {}),
          }),
          io: input.io,
        }),
      );
    } finally {
      release();
    }
  } catch (cause) {
    const error =
      cause instanceof CliError
        ? cause.body()
        : { code: 'CONFIGURATION_ERROR', message: '环境配置或启动参数无效。', details: {} };
    const renderer = input.argv.includes('--json')
      ? new JsonRenderer(input.io)
      : new HumanRenderer(input.io);
    renderer.failure(error);
    return cliExitCode.usage;
  }
}
