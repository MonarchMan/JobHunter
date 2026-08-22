import { spawnSync } from 'node:child_process';

const checks = ['format:check', 'lint', 'boundaries', 'typecheck', 'test', 'docs:check'];
const pnpmEntry = process.env.npm_execpath;

if (!pnpmEntry) {
  throw new Error('This script must be started through pnpm so npm_execpath is available.');
}

for (const check of checks) {
  const result = spawnSync(process.execPath, [pnpmEntry, 'run', check], {
    encoding: 'utf8',
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
