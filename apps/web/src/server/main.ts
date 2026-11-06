import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadRuntimeAppConfig } from '@jobhunter/common/config/index';
import {
  startConfiguredTaskHost,
  acquireTaskServiceLock,
  withTaskServiceOwnership,
  readTaskHostOwner,
} from '@jobhunter/common/task-host-runtime';
import { resolveWebChildEnvironment, resolveWebServerConfig } from './host.js';

// 1、Web 宿主主线程持有调度器与动态线程池，Next 只提供页面入口（ADR-0065）。
const config = resolveWebServerConfig({
  ...process.env,
  ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
});
const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const runtimeConfig = await loadRuntimeAppConfig({ workspaceRoot });
// 1.a、Web 外层持锁直到 Next 进程树和任务线程全部退出，桥关闭不能提前释放写入所有权。
const releaseHost = acquireTaskServiceLock(runtimeConfig.bootstrap.dataRoot.value, 'web');
if (!releaseHost) {
  const owner = readTaskHostOwner(runtimeConfig.bootstrap.dataRoot.value);
  throw new Error(
    '同一数据目录已有运行宿主，请先停止原入口。' +
      (owner ? `（${owner.kind}，PID ${String(owner.pid)}，启动于 ${owner.startedAt}）` : ''),
  );
}
try {
  await withTaskServiceOwnership(runtimeConfig.bootstrap.dataRoot.value, async () => {
    const taskHost = await startConfiguredTaskHost(runtimeConfig, {
      entry: new URL('./task-thread-main.ts', import.meta.url),
      mode: 'web',
    });
    const abort = new AbortController();
    const require = createRequire(import.meta.url);
    const next = spawn(
      process.execPath,
      [
        path.join(import.meta.dirname, 'parent-lifetime.cjs'),
        require.resolve('next/dist/bin/next'),
        config.development ? 'dev' : 'start',
        '--hostname',
        config.host,
        '--port',
        String(config.port),
      ],
      {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        // 1、Windows 上子进程默认新建控制台窗口；Next 由 Web 宿主管理，窗口必须隐藏。
        windowsHide: true,
        env: {
          ...resolveWebChildEnvironment(process.env, config.development),
          JOBHUNTER_WORKSPACE_ROOT: workspaceRoot,
          TASK_HOST_TOKEN: taskHost.token,
        },
      },
    );

    /** Web 停止统一关闭主线程运行时、工作线程与 Next，未完成任务下次恢复。 */
    function stop(): void {
      // 1、标记入口关闭；2、请求 Next 优雅退出，重复信号不重复发送；3、关闭宿主任务运行时。
      abort.abort();
      if (next.connected && next.exitCode === null) next.send('shutdown', () => undefined);
      void closeTaskHost().catch(() => {
        process.exitCode = 1;
      });
    }
    void taskHost.finished.then(stop, () => {
      process.exitCode = 1;
      stop();
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // 3、级联关闭只发起一次；停止分派并等待线程退出，不允许超时后留下业务写入者。
    let cascade: Promise<void> | undefined;
    function closeTaskHost(): Promise<void> {
      return (cascade ??= taskHost.close());
    }
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
      // 4、退出前等待所有任务线程关闭，再释放宿主资源。
      await closeTaskHost();
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      process.off('message', onShutdownMessage);
    }
  });
} finally {
  releaseHost();
}
