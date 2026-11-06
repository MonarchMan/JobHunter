import { runTaskThreadEntry } from '@jobhunter/common/task-host-runtime';
import { createConfiguredTaskApplication } from './task-runtime.js';

// 1、入口只装配业务线程；主线程导入工厂，Worker 执行已分派任务。
await runTaskThreadEntry({
  createApplication: createConfiguredTaskApplication,
});

export { createConfiguredTaskApplication } from './task-runtime.js';
