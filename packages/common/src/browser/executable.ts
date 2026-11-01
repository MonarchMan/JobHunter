import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
/** 浏览器路径解析所需的平台探测端口。 */
export interface BrowserExecutableRuntime {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly configuredPath?: string;
  readonly exists: (candidate: string) => boolean;
}

const systemBrowserRuntime = (): BrowserExecutableRuntime => ({
  platform: process.platform,
  homeDirectory: homedir(),
  ...(process.env.BROWSER_EXECUTABLE ? { configuredPath: process.env.BROWSER_EXECUTABLE } : {}),
  exists: existsSync,
});

/** 按显式配置、环境变量和系统默认值解析浏览器路径。 */
export function resolveBrowserExecutablePath(
  options: { readonly executablePath?: string } = {},
  runtime: BrowserExecutableRuntime = systemBrowserRuntime(),
): string | undefined {
  if (options.executablePath) return options.executablePath;
  if (runtime.configuredPath) return runtime.configuredPath;
  let candidates: readonly string[];
  switch (runtime.platform) {
    case 'win32':
      candidates = [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      break;
    case 'darwin':
      candidates = [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.posix.join(
          runtime.homeDirectory,
          'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ),
        path.posix.join(
          runtime.homeDirectory,
          'Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ),
      ];
      break;
    default:
      candidates = [];
  }
  return candidates.find((candidate) => runtime.exists(candidate));
}
