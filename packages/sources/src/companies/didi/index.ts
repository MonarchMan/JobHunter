export { createDidiAdapter } from './adapter.js';
export {
  didiSites,
  didiConfigSchema,
  didiPageNumbers,
  parseDidiJob,
  parseDidiPage,
  parseDidiDetail,
  parseDidiMokaJob,
  validateDidiCollection,
  didiText,
  type DidiKey,
  type DidiConfig,
  type DidiJob,
} from './protocol.js';
export { didiMokaRuntimeReady, invokeDidiMoka } from './native.js';
export { createDidiSocialAdapter } from './social/index.js';
export { createDidiInternAdapter } from './intern/index.js';
export { createDidiCampusAdapter, createDidiCampusEliteAdapter } from './campus/index.js';
