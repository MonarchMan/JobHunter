import { createMihoyoAdapter } from '../adapter.js';
/** 米哈游社会招聘独立入口，保留全职和第三方编制的真实用工性质。 */
export function createMihoyoSocialAdapter(): ReturnType<typeof createMihoyoAdapter> {
  return createMihoyoAdapter('mihoyo.social');
}
