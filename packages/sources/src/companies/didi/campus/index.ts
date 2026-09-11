import { createDidiAdapter } from '../adapter.js';
/** 常规校园招聘来源。 */
export function createDidiCampusAdapter(): ReturnType<typeof createDidiAdapter> {
  return createDidiAdapter('didi.campus');
}
/** 未来精英独立来源，不能用常规校园招聘代替其验证。 */
export function createDidiCampusEliteAdapter(): ReturnType<typeof createDidiAdapter> {
  return createDidiAdapter('didi.campus.elite');
}
