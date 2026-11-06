import path from 'node:path';
import { taskServiceLockLocation } from '../persistence/task-service-lock.js';

/** 规范化数据目录与本机 IPC 地址；软链接别名必须定位到同一服务。 */
export function taskServiceAddress(
  dataRoot: string,
): Promise<{ dataRoot: string; endpoint: string }> {
  const { root: canonical, directory, key } = taskServiceLockLocation(dataRoot);
  if (process.platform === 'win32')
    return Promise.resolve({ dataRoot: canonical, endpoint: `\\\\.\\pipe\\jobhunter-${key}` });
  // 1、放在用户专属临时目录，避免项目绝对路径超过 Unix socket 长度限制。
  return Promise.resolve({ dataRoot: canonical, endpoint: path.join(directory, `${key}.sock`) });
}
