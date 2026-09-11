import { createKuaishouAdapter } from '../adapter.js';
/** 应届校园招聘独立来源，当前届次 fulltime 项目，包含快 Star 岗位。 */
export function createKuaishouCampusAdapter(): ReturnType<typeof createKuaishouAdapter> {
  return createKuaishouAdapter('kuaishou.campus');
}
