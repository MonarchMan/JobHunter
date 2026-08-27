import {
  appendQuery,
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from './adapter.js';
import { SourceError, type JobSourceAdapter } from '@jobhunter/source-core';
import type { ScriptedConfig } from './schemas.js';
import { alibabaCampusJobSchema } from '../alibaba/schemas.js';
import { byteDanceJobSchema } from '../bytedance/schemas.js';
import { dewuCampusJobSchema } from '../dewu/schemas.js';
import { huaweiCampusJobSchema } from '../huawei/schemas.js';
import { xiaohongshuCampusJobSchema } from '../xiaohongshu/schemas.js';

export const alibabaDefinition: ScriptedAdapterDefinition = {
  key: 'alibaba.campus',
  company: { slug: 'alibaba', name: '阿里巴巴' },
  recruitmentType: 'campus',
  entryUrl: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
  hosts: ['campus-talent.alibaba.com'],
  recordSchema: alibabaCampusJobSchema,
  jobUrl: (_record, id) =>
    `https://campus-talent.alibaba.com/campus/position/${encodeURIComponent(id)}`,
  transport: 'browser',
  browser: {
    listEndpointPath: '/position/search',
    responseShape: 'alibaba-campus',
  },
  request: ({ config, page, requestId, signal, timeoutMs }) =>
    jsonRequest({
      sourceKey: 'alibaba.campus',
      requestId,
      url: appendQuery('https://campus-talent.alibaba.com/position/search', {
        _csrf: config.csrfToken ?? undefined,
      }),
      hosts: ['campus-talent.alibaba.com'],
      signal,
      body: {
        batchId: config.batchId,
        pageIndex: page,
        pageSize: config.pageSize,
        customDeptCode: '',
        channel: config.channel,
        language: config.language,
      },
      headers: {
        origin: 'https://campus-talent.alibaba.com',
        referer: 'https://campus-talent.alibaba.com/campus/position',
      },
      timeoutMs,
    }),
};

export const bytedanceDefinition: ScriptedAdapterDefinition = {
  key: 'bytedance.social',
  company: { slug: 'bytedance', name: '字节跳动' },
  recruitmentType: 'social',
  entryUrl: 'https://jobs.bytedance.com/experienced/position?limit=100',
  hosts: ['jobs.bytedance.com'],
  recordSchema: byteDanceJobSchema,
  transport: 'browser',
  browser: {
    listEndpointPath: '/api/v1/search/job/posts',
    responseShape: 'ats-job-posts',
  },
  requiresRuntimeToken: 'signature',
  request: ({ config, page, requestId, signal, timeoutMs }) => {
    const offset = (page - 1) * config.pageSize;
    return jsonRequest({
      sourceKey: 'bytedance.social',
      requestId,
      url: appendQuery('https://jobs.bytedance.com/api/v1/search/job/posts', {
        keyword: config.keyword,
        limit: config.pageSize,
        offset,
        portal_type: config.portalType,
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
        portal_type: config.portalType,
        job_function_id_list: [],
        storefront_id_list: [],
        portal_entrance: config.portalEntrance,
      },
      headers: {
        origin: 'https://jobs.bytedance.com',
        referer: 'https://jobs.bytedance.com/experienced/position',
      },
      timeoutMs,
    });
  },
};

export const bytedanceCampusDefinition: ScriptedAdapterDefinition = {
  ...bytedanceDefinition,
  key: 'bytedance.campus',
  recruitmentType: 'campus',
  entryUrl: 'https://jobs.bytedance.com/campus/position?limit=100',
  request: ({ config, page, requestId, signal, timeoutMs }) => {
    const offset = (page - 1) * config.pageSize;
    return jsonRequest({
      sourceKey: 'bytedance.campus',
      requestId,
      url: appendQuery('https://jobs.bytedance.com/api/v1/search/job/posts', {
        keyword: config.keyword,
        limit: config.pageSize,
        offset,
        portal_type: 3,
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
        portal_type: 3,
        job_function_id_list: [],
        storefront_id_list: [],
        portal_entrance: config.portalEntrance,
      },
      headers: {
        origin: 'https://jobs.bytedance.com',
        referer: 'https://jobs.bytedance.com/campus/position',
      },
      timeoutMs,
    });
  },
};

export const dewuDefinition: ScriptedAdapterDefinition = {
  key: 'dewu.campus',
  company: { slug: 'dewu', name: '得物' },
  recruitmentType: 'campus',
  entryUrl:
    'https://poizon.jobs.feishu.cn/578078/position/list?keywords=&category=&location=&project=7623619302324226314%2C7309753987297167679&type=&job_hot_flag=&current=1&limit=100&functionCategory=&tag=',
  hosts: ['poizon.jobs.feishu.cn'],
  recordSchema: dewuCampusJobSchema,
  transport: 'browser',
  browser: {
    listEndpointPath: '/api/v1/search/job/posts',
    responseShape: 'ats-job-posts',
  },
  requiresRuntimeToken: 'signature',
  request: ({ config, page, requestId, signal, timeoutMs }) => {
    const offset = (page - 1) * config.pageSize;
    return jsonRequest({
      sourceKey: 'dewu.campus',
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

export const huaweiDefinition: ScriptedAdapterDefinition = {
  key: 'huawei.campus',
  company: { slug: 'huawei', name: '华为' },
  recruitmentType: 'campus',
  entryUrl: 'https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN',
  hosts: ['apigw-dgg-b0.huawei.com', 'career.huawei.com'],
  recordSchema: huaweiCampusJobSchema,
  jobUrl: (record) => {
    const advertisementId = record['advertisementId'];
    if (typeof advertisementId !== 'string' && typeof advertisementId !== 'number') {
      throw new SourceError('parse_changed', 'Huawei job record has no advertisement ID.');
    }
    return `https://career.huawei.com/cn/job-details?advertisementId=${encodeURIComponent(String(advertisementId))}`;
  },
  transport: 'browser',
  browser: {
    listEndpointPath: '/api/apig/channelhw/recruitmentPosition/pub/getJobPage',
    responseShape: 'huawei-campus',
  },
  request: ({ config, page, requestId, signal, timeoutMs }) =>
    jsonRequest({
      sourceKey: 'huawei.campus',
      requestId,
      url: appendQuery(
        'https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/getJobPage',
        {
          'X-HW-ID': config.hwId,
        },
      ),
      hosts: ['apigw-dgg-b0.huawei.com'],
      signal,
      body: {
        curPage: page,
        pageSize: config.pageSize,
        jobType: config.jobType,
        recruitmentType: config.recruitmentType,
      },
      headers: {
        origin: 'https://career.huawei.com',
        referer: 'https://career.huawei.com/',
        'X-HW-ID': config.hwId,
        'x-language': 'zh_CN',
      },
      timeoutMs,
    }),
};

export const xiaohongshuDefinition: ScriptedAdapterDefinition = {
  key: 'xiaohongshu.campus',
  company: { slug: 'xiaohongshu', name: '小红书' },
  recruitmentType: 'campus',
  entryUrl: 'https://job.xiaohongshu.com/campus/position',
  hosts: ['job.xiaohongshu.com'],
  recordSchema: xiaohongshuCampusJobSchema,
  jobUrl: (_record, id) => `https://job.xiaohongshu.com/campus/position/${encodeURIComponent(id)}`,
  request: ({ config, page, requestId, signal, timeoutMs }) =>
    jsonRequest({
      sourceKey: 'xiaohongshu.campus',
      requestId,
      url: 'https://job.xiaohongshu.com/websiterecruit/position/pageQueryPosition',
      hosts: ['job.xiaohongshu.com'],
      signal,
      body: {
        recruitType: 'campus',
        positionName: config.keyword,
        pageNum: page,
        pageSize: config.pageSize,
      },
      headers: {
        origin: 'https://job.xiaohongshu.com',
        referer: 'https://job.xiaohongshu.com/campus/position',
        ...(config.xS === null ? {} : { 'x-s': config.xS }),
        ...(config.xSCommon === null ? {} : { 'x-s-common': config.xSCommon }),
        ...(config.xT === null ? {} : { 'x-t': config.xT }),
      },
      timeoutMs,
    }),
};

export const createAlibabaAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(alibabaDefinition);
export const createByteDanceAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(bytedanceDefinition);
export const createByteDanceCampusAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(bytedanceCampusDefinition);
export const createDewuAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(dewuDefinition);
export const createHuaweiAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(huaweiDefinition);
export const createXiaohongshuAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(xiaohongshuDefinition);
