import { createBilibiliChannelAdapter } from '../shared/adapter.js';
import { bilibiliCampusProtocol } from '../campus/schemas.js';
/** B 站实习总列表独立适配器，不按标题或项目年份猜测类别。 */
export function createBilibiliInternAdapter(): ReturnType<typeof createBilibiliChannelAdapter> {
  const protocol = bilibiliCampusProtocol('intern');
  return createBilibiliChannelAdapter({
    channel: 'intern',
    entryUrl: 'https://jobs.bilibili.com/campus/positions?type=0',
    detailBaseUrl: 'https://jobs.bilibili.com/campus/positions',
    listEndpointPath: '/api/campus/position/positionList',
    responseShape: 'bilibili-intern',
    parseJob: protocol.parseJob,
    parsePage: protocol.parsePage,
  });
}
