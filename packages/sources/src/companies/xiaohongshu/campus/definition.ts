import type { JobSourceAdapter } from '@jobhunter/source-core';
import {
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../../shared/scripted/schemas.js';
import { xiaohongshuCampusJobSchema } from './schemas.js';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function definition(
  key: 'xiaohongshu.campus' | 'xiaohongshu.social',
  recruitType: 'campus' | 'social',
): ScriptedAdapterDefinition {
  const entryUrl = `https://job.xiaohongshu.com/${recruitType}/position`;
  return {
    key,
    company: { slug: 'xiaohongshu', name: '小红书' },
    recruitmentType: recruitType,
    entryUrl,
    hosts: ['job.xiaohongshu.com'],
    recordSchema: xiaohongshuCampusJobSchema,
    jobUrl: (_record, id) => `${entryUrl}/${encodeURIComponent(id)}`,
    request: ({ config, page, requestId, signal, timeoutMs }) =>
      jsonRequest({
        sourceKey: key,
        requestId,
        url: 'https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition',
        hosts: ['job.xiaohongshu.com'],
        signal,
        body: {
          recruitType,
          positionName: config.keyword,
          pageNum: page,
          pageSize: config.pageSize,
        },
        headers: {
          origin: 'https://job.xiaohongshu.com',
          referer: entryUrl,
          ...(config.xS === null ? {} : { 'x-s': config.xS }),
          ...(config.xSCommon === null ? {} : { 'x-s-common': config.xSCommon }),
          ...(config.xT === null ? {} : { 'x-t': config.xT }),
        },
        timeoutMs,
      }),
  };
}

/** 来源适配器使用的稳定配置或常量。 */
export const xiaohongshuDefinition = definition('xiaohongshu.campus', 'campus');
/** 来源适配器使用的稳定配置或常量。 */
export const xiaohongshuSocialDefinition = definition('xiaohongshu.social', 'social');

/** 招聘来源适配器实例。 */
export const createXiaohongshuAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(xiaohongshuDefinition);

/** 招聘来源适配器实例。 */
export const createXiaohongshuSocialAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(xiaohongshuSocialDefinition);
