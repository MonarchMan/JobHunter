import { runInternalTaskHost } from '@jobhunter/common/task-service';
import { createConfiguredTaskApplication } from './task-runtime.js';

// 1、Web 与 CLI 使用 common 同一套中央服务协议，谁先启动都不改变业务装配。
await runInternalTaskHost({
  entry: new URL(import.meta.url),
  createApplication: createConfiguredTaskApplication,
});
