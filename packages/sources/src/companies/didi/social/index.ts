import { createDidiAdapter } from '../adapter.js';
/** 国内社会招聘匿名 HTTP 来源，独立延迟详情。 */
export function createDidiSocialAdapter(): ReturnType<typeof createDidiAdapter> {
  return createDidiAdapter('didi.social');
}
