import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveWebServerConfig } from './host.js';

const config = resolveWebServerConfig({
  ...process.env,
  ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
});
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const tsxBin = path.join(path.dirname(require.resolve('tsx')), 'cli.mjs');
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const workerSource = path.join(workspaceRoot, 'apps', 'worker', 'src', 'main.ts');
const workerDist = path.join(workspaceRoot, 'apps', 'worker', 'dist', 'main.js');
const workerArguments = config.development ? [tsxBin, workerSource] : [workerDist];
const worker = spawn(process.execPath, workerArguments, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
  },
});
const next = spawn(
  process.execPath,
  [
    nextBin,
    config.development ? 'dev' : 'start',
    '--hostname',
    config.host,
    '--port',
    String(config.port),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
    },
  },
);

let shuttingDown = false;

function stop(child: ChildProcess): void {
  if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
}

function stopAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(next);
  stop(worker);
}

function handleChildError(error: Error): void {
  if (shuttingDown) return;
  console.error('Web 或 Worker 子进程启动失败:', error);
  process.exitCode = 1;
  shuttingDown = true;
  stop(next);
  stop(worker);
}

next.once('error', handleChildError);
worker.once('error', handleChildError);

next.once('exit', (code, signal) => {
  if (!shuttingDown) {
    process.exitCode = code ?? (signal ? 1 : 0);
    stop(worker);
  }
});

worker.once('exit', (code, signal) => {
  if (!shuttingDown) {
    process.exitCode = code ?? (signal ? 1 : 0);
    stop(next);
  }
});

const forward = (signal: NodeJS.Signals): void => {
  shuttingDown = true;
  if (!next.killed) next.kill(signal);
  if (!worker.killed) worker.kill(signal);
};
process.once('SIGINT', () => {
  forward('SIGINT');
});
process.once('SIGTERM', () => {
  forward('SIGTERM');
});
process.once('exit', stopAll);
