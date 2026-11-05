import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import { ensureConfiguredTaskService } from '@jobhunter/common/task-service';
import { resolveWebChildEnvironment, resolveWebServerConfig } from './host.js';

// 1、Web 宿主只管理 Next；任务由独立生命周期的中央服务统一分派。
const config = resolveWebServerConfig({
  ...process.env,
  ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
});
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const runtimeConfig = await loadRuntimeAppConfig({ workspaceRoot });
await ensureConfiguredTaskService(runtimeConfig, {
  entry: new URL('./task-service-main.ts', import.meta.url),
  workspaceRoot,
}).catch((error: unknown) => {
  console.error('中央任务服务不可用:', error);
});
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

/** Web 关闭只停止 Next 和本机连接，不停止中央任务服务。 */
function stop(): void {
  // 1、标记入口关闭；2、请求 Next 优雅退出，重复信号不重复发送。
  abort.abort();
  if (!next.killed && next.exitCode === null) next.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
// 2.a、Windows 无法向子进程投递 POSIX 信号（kill 直接终止进程），父进程改经 IPC 请求优雅关闭。
// 注册 message 监听会重新引用 IPC 通道，随后 unref 以免清理完成后事件循环被通道挂住。
const onShutdownMessage = (message: unknown): void => {
  if (message === 'shutdown') stop();
};
if (process.send) {
  process.on('message', onShutdownMessage);
  process.channel?.unref();
}
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
try {
  await exited;
} finally {
  stop();
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  process.off('message', onShutdownMessage);
}
