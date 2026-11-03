import { createBilibiliChannelAdapter } from '../shared/adapter.js';
import { bilibiliCampusProtocol } from '../campus/schemas.js';
/** B 站应届全职独立适配器，不按标题或项目年份猜测类别。 */
export function createBilibiliCampusAdapter(): ReturnType<typeof createBilibiliChannelAdapter> {
  const protocol = bilibiliCampusProtocol('campus');
  return createBilibiliChannelAdapter({
    channel: 'campus',
    entryUrl: 'https://jobs.bilibili.com/campus/positions',
    detailBaseUrl: 'https://jobs.bilibili.com/campus/positions',
    listEndpointPath: '/api/campus/position/positionList',
    responseShape: 'bilibili-campus',
    parseJob: protocol.parseJob,
    parsePage: protocol.parsePage,
  });
}
