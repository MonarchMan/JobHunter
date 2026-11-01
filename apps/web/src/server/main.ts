import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import { createConfiguredTaskApplication } from './task-runtime.js';
import { resolveWebChildEnvironment, resolveWebServerConfig } from './host.js';

// 1、Web 宿主同时承载任务循环与 Next 生命周期，不启动独立 Worker 入口。
const config = resolveWebServerConfig({
  ...process.env,
  ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
});
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const runtimeConfig = await loadRuntimeAppConfig({ workspaceRoot });
const application = createConfiguredTaskApplication(runtimeConfig);
const abort = new AbortController();
const require = createRequire(import.meta.url);
const next = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    config.development ? 'dev' : 'start',
    '--hostname',
    config.host,
    '--port',
    String(config.port),
  ],
  {
    stdio: 'inherit',
    env: {
      ...resolveWebChildEnvironment(process.env, config.development),
      JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
    },
  },
);

/** 关闭请求同时停止任务领取和 Web，随后等待在途工作及资源释放。 */
function stop(): void {
  // 1、取消公共循环；2、请求 Next 优雅退出，重复信号不重复发送。
  abort.abort();
  if (!next.killed && next.exitCode === null) next.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const exited = new Promise<void>((resolve) => {
  next.once('error', (error) => {
    console.error('Web 启动失败:', error);
    process.exitCode = 1;
    stop();
    resolve();
  });
  next.once('exit', (code, signal) => {
    if (!abort.signal.aborted) process.exitCode = code ?? (signal ? 1 : 0);
    abort.abort();
    resolve();
  });
});
// 2、任务循环异常必须通知宿主并关闭 Web，不能让界面继续声称后台可用。
const running = application.engine.run(abort.signal).catch((error: unknown) => {
  console.error('任务运行时失败:', error);
  process.exitCode = 1;
  stop();
});
try {
  await exited;
  await running;
} finally {
  // 3、回收所有模块资源后解除信号监听，内部维护子进程也必须结束。
  stop();
  try {
    await application.close();
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
