/** 来源契约包的公开导出入口。 */
export * from './contract.js';
export * from './contract-testkit.js';
export * from './errors.js';
export * from './external-id.js';
export * from './http-client.js';
export * from './registry.js';
export * from './strategy.js';
export * from './url-policy.js';
export * from './rate-limit-gate.js';

/** Public package identifier used by composition smoke tests. */
/** 来源模块使用的稳定配置或常量。 */
export const packageId = '@jobhunter/source-core' as const;
