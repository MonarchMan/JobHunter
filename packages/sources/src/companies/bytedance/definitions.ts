import type { JobSourceAdapter } from '@jobhunter/source-core';
import {
  appendQuery,
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../shared/scripted/schemas.js';
import { byteDanceJobSchema } from './schemas.js';

function requestFor(key: 'bytedance.social' | 'bytedance.campus', portalType: number) {
  return ({
    config,
    page,
    requestId,
    signal,
    timeoutMs,
  }: Parameters<ScriptedAdapterDefinition['request']>[0]) => {
    const offset = (page - 1) * config.pageSize;
    const campus = key === 'bytedance.campus';
    return jsonRequest({
      sourceKey: key,
      requestId,
      url: appendQuery('https://jobs.bytedance.com/api/v1/search/job/posts', {
        keyword: config.keyword,
        limit: config.pageSize,
        offset,
        portal_type: portalType,
        portal_entrance: config.portalEntrance,
        _signature: config.signature ?? undefined,
      }),
      hosts: ['jobs.bytedance.com'],
      signal,
      body: {
        keyword: config.keyword,
        limit: config.pageSize,
        offset,
        job_category_id_list: [],
        tag_id_list: [],
        location_code_list: [],
        subject_id_list: [],
        recruitment_id_list: [],
        portal_type: portalType,
        job_function_id_list: [],
        storefront_id_list: [],
        portal_entrance: config.portalEntrance,
      },
      headers: {
        origin: 'https://jobs.bytedance.com',
        referer: campus
          ? 'https://jobs.bytedance.com/campus/position'
          : 'https://jobs.bytedance.com/experienced/position',
      },
      timeoutMs,
    });
  };
}

export const bytedanceDefinition: ScriptedAdapterDefinition = {
  key: 'bytedance.social',
  company: { slug: 'bytedance', name: '字节跳动' },
  recruitmentType: 'social',
  entryUrl: 'https://jobs.bytedance.com/experienced/position?limit=100',
  hosts: ['jobs.bytedance.com'],
  recordSchema: byteDanceJobSchema,
  transport: 'browser',
  browser: { listEndpointPath: '/api/v1/search/job/posts', responseShape: 'ats-job-posts' },
  requiresRuntimeToken: 'signature',
  request: requestFor('bytedance.social', 2),
};

export const bytedanceCampusDefinition: ScriptedAdapterDefinition = {
  ...bytedanceDefinition,
  key: 'bytedance.campus',
  recruitmentType: 'campus',
  entryUrl: 'https://jobs.bytedance.com/campus/position?limit=100',
  request: requestFor('bytedance.campus', 3),
};

export const createByteDanceAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(bytedanceDefinition);
export const createByteDanceCampusAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(bytedanceCampusDefinition);
