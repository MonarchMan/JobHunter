import { createKuaishouAdapter } from '../adapter.js';
/** 日常实习独立来源，主站 C002，不限制境内地点。 */
export function createKuaishouInternAdapter(): ReturnType<typeof createKuaishouAdapter> {
  return createKuaishouAdapter('kuaishou.intern');
}
/** 校园留用实习独立来源，当前届次 intern 项目。 */
export function createKuaishouCampusInternAdapter(): ReturnType<typeof createKuaishouAdapter> {
  return createKuaishouAdapter('kuaishou.intern.campus');
}
