import { createCtripAdapter } from '../adapter.js';
/** 携程应届校招来源，保留全部职位类别。 */
export function createCtripCampusAdapter(): ReturnType<typeof createCtripAdapter> {
  return createCtripAdapter('ctrip.campus');
}
