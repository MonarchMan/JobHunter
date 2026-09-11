export { createKuaishouAdapter } from './adapter.js';
export { invokeKuaishouRuntime, kuaishouRuntimeReady } from './native.js';
export {
  kuaishouDefinitions,
  kuaishouConfigSchema,
  kuaishouSite,
  parseKuaishouDictionaries,
  selectKuaishouProject,
  parseKuaishouJob,
  parseKuaishouPage,
  validateKuaishouCollection,
  type KuaishouKey,
  type KuaishouConfig,
} from './protocol.js';
export { createKuaishouSocialAdapter } from './social/index.js';
export { createKuaishouInternAdapter, createKuaishouCampusInternAdapter } from './intern/index.js';
export { createKuaishouCampusAdapter } from './campus/index.js';
