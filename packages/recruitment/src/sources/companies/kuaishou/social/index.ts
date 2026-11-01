import { createKuaishouAdapter } from '../adapter.js';
/** 快手社会招聘独立来源，C001 + socialr。 */
export function createKuaishouSocialAdapter(): ReturnType<typeof createKuaishouAdapter> {
  return createKuaishouAdapter('kuaishou.social');
}
