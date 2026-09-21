import { homedir, platform } from 'node:os';
import path from 'node:path';
import { PlatformError } from '@jobhunter/platform-core';

/** 仅读一个已知描述文件；不递归扫描配置目录，也不读取磁盘凭据。 */
export function chromePortFile(): string {
  // 1、自定义配置由本机 Worker 环境指定，否则使用系统标准 Chrome 位置。
  const configured = process.env.JOBHUNTER_CHROME_PORT_FILE;
  if (configured) return configured;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort');
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local'),
        'Google/Chrome/User Data/DevToolsActivePort',
      );
    case 'linux':
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        'google-chrome/DevToolsActivePort',
      );
    default:
      throw new PlatformError('session_unavailable', null, 'browser_not_found');
  }
}
