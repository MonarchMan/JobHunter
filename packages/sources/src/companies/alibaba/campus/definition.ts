import type { JobSourceAdapter } from '@jobhunter/source-core';
import {
  appendQuery,
  createScriptedAdapter,
  jsonRequest,
  type ScriptedAdapterDefinition,
} from '../../../shared/scripted/adapter.js';
import type { ScriptedConfig } from '../../../shared/scripted/schemas.js';
import { alibabaCampusJobSchema } from './schemas.js';

function definition(options: {
  readonly key: 'alibaba.campus' | 'alibaba.social';
  readonly recruitmentType: 'campus' | 'social';
  readonly entryUrl: string;
  readonly host: string;
}): ScriptedAdapterDefinition {
  return {
    key: options.key,
    company: { slug: 'alibaba', name: '阿里巴巴' },
    recruitmentType: options.recruitmentType,
    ...(options.recruitmentType === 'social'
      ? { fixedRecruitmentCategory: 'social' as const }
      : {}),
    entryUrl: options.entryUrl,
    hosts: [options.host],
    recordSchema: alibabaCampusJobSchema,
    jobUrl: (_record, id) =>
      options.recruitmentType === 'social'
        ? `https://talent-holding.alibaba.com/off-campus/position-detail?positionId=${encodeURIComponent(id)}`
        : `https://campus-talent.alibaba.com/campus/position/${encodeURIComponent(id)}`,
    transport: 'browser',
    browser: { listEndpointPath: '/position/search', responseShape: 'alibaba-campus' },
    request: ({ config, page, requestId, signal, timeoutMs }) =>
      jsonRequest({
        sourceKey: options.key,
        requestId,
        url: appendQuery(`https://${options.host}/position/search`, {
          _csrf: config.csrfToken ?? undefined,
        }),
        hosts: [options.host],
        signal,
        body: {
          batchId: options.recruitmentType === 'social' ? '' : config.batchId,
          pageIndex: page,
          pageSize: config.pageSize,
          ...(options.recruitmentType === 'social'
            ? {
                categories: '',
                deptCodes: [],
                key: config.keyword,
                regions: '',
                subCategories: '',
                shareType: '',
                shareId: '',
                myReferralShareCode: '',
              }
            : { customDeptCode: '' }),
          channel: config.channel,
          language: config.language,
        },
        headers: {
          origin: `https://${options.host}`,
          referer: options.entryUrl,
        },
        timeoutMs,
      }),
  };
}

export const alibabaDefinition = definition({
  key: 'alibaba.campus',
  recruitmentType: 'campus',
  entryUrl: 'https://campus-talent.alibaba.com/campus/position?batchId=100000560002',
  host: 'campus-talent.alibaba.com',
});

export const alibabaSocialDefinition = definition({
  key: 'alibaba.social',
  recruitmentType: 'social',
  entryUrl: 'https://talent-holding.alibaba.com/off-campus/position-list',
  host: 'talent-holding.alibaba.com',
});

export const createAlibabaAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(alibabaDefinition);

export const createAlibabaSocialAdapter = (): JobSourceAdapter<ScriptedConfig, never> =>
  createScriptedAdapter(alibabaSocialDefinition);
