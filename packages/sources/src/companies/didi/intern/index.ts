import { createDidiAdapter } from '../adapter.js';
/** 官网导航授权的 Moka 实习站，按记录性质校验。 */
export function createDidiInternAdapter(): ReturnType<typeof createDidiAdapter> {
  return createDidiAdapter('didi.intern');
}
