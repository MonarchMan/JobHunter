import type { JobSourceAdapter } from '@jobhunter/source-core';
import {
  appendQuery,
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../../shared/scripted/schemas.js';
import { dewuCampusJobSchema } from './schemas.js';

function definition(
  key: 'dewu.campus' | 'dewu.social',
  recruitmentType: 'campus' | 'social',
  entryUrl: string,
): ScriptedAdapterDefinition {
  return {
    key,
    company: { slug: 'dewu', name: '得物' },
    recruitmentType,
    ...(recruitmentType === 'social' ? { fixedRecruitmentCategory: 'social' as const } : {}),
    entryUrl,
    hosts: ['poizon.jobs.feishu.cn'],
    recordSchema: dewuCampusJobSchema,
    transport: 'browser',
    browser: { listEndpointPath: '/api/v1/search/job/posts', responseShape: 'ats-job-posts' },
    requiresRuntimeToken: 'signature',
    request: ({ config, page, requestId, signal, timeoutMs }) => {
      const offset = (page - 1) * config.pageSize;
      return jsonRequest({
        sourceKey: key,
        requestId,
        url: appendQuery('https://poizon.jobs.feishu.cn/api/v1/search/job/posts', {
          keyword: config.keyword,
          limit: config.pageSize,
          offset,
          subject_id_list: config.subjectIdList.join(','),
          portal_type: 6,
          portal_entrance: config.portalEntrance,
          _signature: config.signature ?? undefined,
        }),
        hosts: ['poizon.jobs.feishu.cn'],
        signal,
        body: {
          keyword: config.keyword,
          limit: config.pageSize,
          offset,
          job_category_id_list: [],
          tag_id_list: [],
          location_code_list: [],
          subject_id_list: config.subjectIdList,
          recruitment_id_list: [],
          portal_type: 6,
          job_function_id_list: [],
          storefront_id_list: [],
          portal_entrance: config.portalEntrance,
        },
        headers: {
          origin: 'https://poizon.jobs.feishu.cn',
          referer: 'https://poizon.jobs.feishu.cn/578078/position/list',
        },
        timeoutMs,
      });
    },
  };
}

export const dewuDefinition = definition(
  'dewu.campus',
  'campus',
  'https://poizon.jobs.feishu.cn/578078/position/list?keywords=&category=&location=&project=7623619302324226314%2C7309753987297167679&type=&job_hot_flag=&current=1&limit=100&functionCategory=&tag=',
);

export const dewuSocialDefinition = definition(
  'dewu.social',
  'social',
  'https://poizon.jobs.feishu.cn/index/position',
);

export const createDewuAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(dewuDefinition);

export const createDewuSocialAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(dewuSocialDefinition);
