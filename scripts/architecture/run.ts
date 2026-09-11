import { spawnSync } from 'node:child_process';

/** 架构命令的固定执行序列，避免依赖不同终端对命令连接符的解释。 */
const sequences: Record<string, string[][]> = {
  check: [
    ['exec', 'tsc', '-p', 'scripts/architecture/tsconfig.json'],
    ['exec', 'tsx', 'scripts/architecture/build.ts', '--check'],
  ],
  serve: [
    ['run', 'architecture:build'],
    ['exec', 'tsx', 'scripts/architecture/serve.ts'],
  ],
};

// 1. 只接受固定工作流，并复用 pnpm 提供的入口，不拼接 Shell 命令。
const sequence = sequences[process.argv[2] ?? ''];
const pnpmEntry = process.env.npm_execpath;
if (!sequence || !pnpmEntry) {
  throw new Error('请通过 pnpm architecture:check 或 pnpm architecture:serve 启动。');
}

// 2. 顺序执行，前置校验或构建失败时立即退出，不继续启动后续进程。
for (const args of sequence) {
  const result = spawnSync(process.execPath, [pnpmEntry, ...args], {
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
