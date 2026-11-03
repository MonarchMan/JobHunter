import { createBilibiliChannelAdapter } from '../shared/adapter.js';
import { parseBilibiliSocialJob, parseBilibiliSocialPage } from './schemas.js';
export { bilibiliDescriptionText } from '../shared/adapter.js';
/** 社招仅接收全职社会招聘记录，保持原入口与协议。 */
export function createBilibiliSocialAdapter(): ReturnType<typeof createBilibiliChannelAdapter> {
  return createBilibiliChannelAdapter({
    channel: 'social',
    entryUrl: 'https://jobs.bilibili.com/social/positions',
    detailBaseUrl: 'https://jobs.bilibili.com/social/positions',
    listEndpointPath: '/api/srs/position/positionList',
    responseShape: 'bilibili-social',
    parseJob: parseBilibiliSocialJob,
    parsePage: parseBilibiliSocialPage,
  });
}
