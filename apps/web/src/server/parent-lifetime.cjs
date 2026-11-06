const { spawn, execFile } = require('node:child_process');

// 1、包装器持有父 IPC；不给 Next CLI 增加 IPC，避免触发框架内部 Worker 协议。
const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: true,
  detached: process.platform !== 'win32',
});
let stopping = false;
let force;

/** 只回收本次创建的 Next 进程树，宿主强杀时同样执行。 */
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // 2、Windows 用原生进程树回收；PID 来自本次 spawn，不扫描其他应用。
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
      /* 回收由 exit 确认。 */
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Next 已结束。 */
    }
    force = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* 进程组已回收。 */
      }
    }, 10_000);
    force.unref();
  }
}
process.once('disconnect', stop);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', (message) => {
  if (message === 'shutdown') stop();
});
child.once('error', () => {
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
child.once('exit', (code) => {
  if (force) clearTimeout(force);
  process.exitCode = stopping ? 0 : (code ?? 1);
  if (process.connected) process.disconnect();
});
