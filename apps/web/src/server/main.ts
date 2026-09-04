import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveWebServerConfig } from './host.js';

// 1、解析 Web 配置；2、启动 Worker；3、启动 Next 服务；4、统一转发退出和子进程错误。
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

/** 请求单个子进程优雅退出。 */
function stop(child: ChildProcess): void {
  if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
}

/** 在主进程退出时停止 Web 与 Worker 子进程。 */
function stopAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(next);
  stop(worker);
}

/** 处理子进程启动错误并触发统一退出。 */
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
    /** 执行模块适配器的该项操作。 */
    stop(worker);
  }
});

worker.once('exit', (code, signal) => {
  if (!shuttingDown) {
    process.exitCode = code ?? (signal ? 1 : 0);
    /** 执行模块适配器的该项操作。 */
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
