import { runInternalTaskHost } from '@jobhunter/common/task-service';
import { createConfiguredTaskApplication } from './task-runtime.js';

// 1、内部组合根显式装配四模块；该文件没有公开命令或独立 workspace 包。
await runInternalTaskHost({
  entry: new URL(import.meta.url),
  createApplication: createConfiguredTaskApplication,
});
