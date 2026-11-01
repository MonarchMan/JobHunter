import { spawnSync } from 'node:child_process';

const checks = ['format:check', 'lint', 'boundaries', 'typecheck', 'test', 'docs:check'];
const pnpmEntry = process.env.npm_execpath;

if (!pnpmEntry) {
  throw new Error('This script must be started through pnpm so npm_execpath is available.');
}

// pnpm 的原生分发形式必须直接执行；JS 分发形式才通过 Node 启动。
const isJavaScriptEntry = /\.[cm]?js$/iu.test(pnpmEntry);
for (const check of checks) {
  const result = spawnSync(
    isJavaScriptEntry ? process.execPath : pnpmEntry,
    isJavaScriptEntry ? [pnpmEntry, 'run', check] : ['run', check],
    {
      encoding: 'utf8',
      env: process.env,
      shell: false,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
