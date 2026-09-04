import type { UtcInstant } from './instant.js';

/** 模块数据结构或契约。 */
export interface Clock {
  now(): UtcInstant;
}
