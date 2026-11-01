import { createMihoyoAdapter } from '../adapter.js';
/** 米哈游应届校园岗位独立入口。 */
export function createMihoyoCampusAdapter(): ReturnType<typeof createMihoyoAdapter> {
  return createMihoyoAdapter('mihoyo.campus');
}
