export * from './catalog/index.js';
export * from './alibaba/schemas.js';
export * from './baidu/index.js';
export * from './browser/browser-pool.js';
export * from './bytedance/schemas.js';
export * from './dewu/schemas.js';
export * from './huawei/schemas.js';
export * from './jd/index.js';
export * from './jd-campus/index.js';
export * from './meituan/index.js';
export * from './pinduoduo/index.js';
export * from './scripted/index.js';
export * from './tencent/index.js';
export * from './tencent-campus/index.js';
export * from './xiaohongshu/schemas.js';
export * from './job-taxonomy.js';
export * from './recruitment-category.js';

/** Public package identifier used by composition smoke tests. */
export const packageId = '@jobhunter/sources' as const;
