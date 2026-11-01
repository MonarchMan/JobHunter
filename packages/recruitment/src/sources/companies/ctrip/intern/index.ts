import { createCtripAdapter } from '../adapter.js';
/** 携程日常实习来源，不包含尚未开放的留用实习。 */
export function createCtripInternAdapter(): ReturnType<typeof createCtripAdapter> {
  return createCtripAdapter('ctrip.intern');
}
