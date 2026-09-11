import { createCtripAdapter } from '../adapter.js';
/** 携程社会正式岗位来源。 */
export function createCtripSocialAdapter(): ReturnType<typeof createCtripAdapter> {
  return createCtripAdapter('ctrip.social');
}
