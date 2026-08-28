import type { JobSourceAdapter } from '@jobhunter/source-core';
import {
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../../shared/scripted/schemas.js';
import { xiaohongshuCampusJobSchema } from './schemas.js';

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

export const xiaohongshuDefinition = definition('xiaohongshu.campus', 'campus');
export const xiaohongshuSocialDefinition = definition('xiaohongshu.social', 'social');

export const createXiaohongshuAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(xiaohongshuDefinition);

export const createXiaohongshuSocialAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(xiaohongshuSocialDefinition);
