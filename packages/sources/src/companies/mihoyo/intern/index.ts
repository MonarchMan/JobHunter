import { createMihoyoAdapter } from '../adapter.js';
/** 米哈游校园实习专项独立入口。 */
export function createMihoyoInternAdapter(): ReturnType<typeof createMihoyoAdapter> {
  return createMihoyoAdapter('mihoyo.intern');
}
