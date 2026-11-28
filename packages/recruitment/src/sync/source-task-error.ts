import type { TaskErrorCategory } from '@jobhunter/common/tasks';

/** 官网同步与详情任务共用的来源错误分类；取消由各任务流程处理。 */
export const sourceTaskErrors: ReadonlyMap<string | null, TaskErrorCategory> = new Map([
  ['temporary', 'network_temporary'],
  ['rate_limited', 'rate_limited'],
  ['invalid_config', 'invalid_config'],
  ['parse_changed', 'parse_changed'],
]);
