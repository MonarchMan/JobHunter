import { SourceError, type JobSourceAdapter } from '@jobhunter/source-core';
import {
  appendQuery,
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../../shared/scripted/schemas.js';
import { huaweiCampusJobSchema } from './schemas.js';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function definition(
  key: 'huawei.intern' | 'huawei.campus',
  entryUrl: string,
): ScriptedAdapterDefinition {
  return {
    key,
    company: { slug: 'huawei', name: '华为' },
    recruitmentType: 'campus',
    entryUrl,
    hosts: ['apigw-dgg-b0.huawei.com', 'career.huawei.com'],
    recordSchema: huaweiCampusJobSchema,
    jobUrl: (record) => {
      const id = record.advertisementId;
      if (typeof id !== 'string' && typeof id !== 'number')
        throw new SourceError('parse_changed', 'Huawei job record has no advertisement ID.');
      return `https://career.huawei.com/cn/job-details?advertisementId=${encodeURIComponent(String(id))}`;
    },
    transport: 'browser',
    browser: {
      listEndpointPath: '/api/apig/channelhw/recruitmentPosition/pub/getJobPage',
      responseShape: 'huawei-campus',
    },
    request: ({ config, page, requestId, signal, timeoutMs }) =>
      jsonRequest({
        sourceKey: key,
        requestId,
        url: appendQuery(
          'https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/getJobPage',
          { 'X-HW-ID': config.hwId },
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
}

/** 来源适配器使用的稳定配置或常量。 */
export const huaweiDefinition = definition(
  'huawei.intern',
  'https://career.huawei.com/cn/campus-recruitment-job-list?recruitmentType=INTERN',
);

/** 来源适配器使用的稳定配置或常量。 */
export const huaweiCampusDefinition = definition(
  'huawei.campus',
  'https://career.huawei.com/cn/campus-recruitment-job-list',
);

/** 招聘来源适配器实例。 */
export const createHuaweiAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(huaweiDefinition);

/** 招聘来源适配器实例。 */
export const createHuaweiCampusAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(huaweiCampusDefinition);
