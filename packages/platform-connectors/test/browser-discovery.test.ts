import { afterEach, expect, it, vi } from 'vitest';
import { chromePortFile } from '../src/browser-discovery.js';

const machine = vi.hoisted(() => ({ system: 'darwin' }));
vi.mock('node:os', () => ({ homedir: () => '/fixture-user', platform: () => machine.system }));
afterEach(() => vi.unstubAllEnvs());

it('按系统固定位置发现描述文件，允许显式覆盖，不扫描磁盘', () => {
  vi.stubEnv('JOBHUNTER_CHROME_PORT_FILE', '');
  machine.system = 'darwin';
  expect(chromePortFile()).toBe(
    '/fixture-user/Library/Application Support/Google/Chrome/DevToolsActivePort',
  );
  machine.system = 'linux';
  vi.stubEnv('XDG_CONFIG_HOME', '/fixture-config');
  expect(chromePortFile()).toBe('/fixture-config/google-chrome/DevToolsActivePort');
  machine.system = 'win32';
  vi.stubEnv('LOCALAPPDATA', '/fixture-local');
  expect(chromePortFile()).toBe('/fixture-local/Google/Chrome/User Data/DevToolsActivePort');
  vi.stubEnv('JOBHUNTER_CHROME_PORT_FILE', '/custom/DevToolsActivePort');
  expect(chromePortFile()).toBe('/custom/DevToolsActivePort');
});

it('不支持的系统只返回固定诊断，不猜测其他浏览器配置', () => {
  vi.stubEnv('JOBHUNTER_CHROME_PORT_FILE', '');
  machine.system = 'unsupported';
  expect(() => chromePortFile()).toThrow('session_unavailable');
});
