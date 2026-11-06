import { runTaskThreadEntry } from '@jobhunter/common/task-host-runtime';
import { createConfiguredTaskApplication } from './task-runtime.js';

// 1、内部组合根显式装配四模块；该文件没有公开命令或独立 workspace 包。
await runTaskThreadEntry({
  createApplication: createConfiguredTaskApplication,
});

export { createConfiguredTaskApplication } from './task-runtime.js';
