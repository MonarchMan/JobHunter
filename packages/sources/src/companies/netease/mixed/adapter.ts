import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  neteaseConfigSchema,
  neteaseJobSchema,
  neteaseListSchema,
  type NeteaseConfig,
  type NeteaseJob,
} from './schemas.js';

const hosts = ['hr.163.com'] as const;
const entryUrl = 'https://hr.163.com/job-list.html';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function category(job: NeteaseJob): 'internship' | 'social' {
  return job.workType === '1' || /实习|intern/i.test(job.name) ? 'internship' : 'social';
}

export function createNeteaseAdapter(): JobSourceAdapter<NeteaseConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: 'netease.mixed',
      version: '1.0.1',
      company: { slug: 'netease', name: '网易' },
      recruitmentType: 'mixed',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'browser' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: neteaseConfigSchema,
    browser: {
      listEndpointPath: '/api/hr163/position/queryPage',
      responseShape: 'netease-jobs',
    },
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: 'netease.mixed',
      requestId,
      url: 'https://hr.163.com/api/hr163/position/queryPage',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://hr.163.com',
        referer: entryUrl,
      },
      body: JSON.stringify({
        currentPage: page,
        pageSize: config.pageSize,
        ...(config.keyword ? { keyword: config.keyword } : {}),
      }),
    }),
    parsePage: (body) => {
      const parsed = neteaseListSchema.parse(body).data;
      return { records: parsed.list, total: parsed.total };
    },
    parseRecord: (value) => neteaseJobSchema.parse(value),
    fields: (job: NeteaseJob) => ({
      externalJobId: String(job.id),
      title: job.name,
      department: job.firstDepName ?? job.productName ?? null,
      taxonomyText: job.firstPostTypeName ?? job.name,
      recruitmentCategory: category(job),
      locations: job.workPlaceNameList,
      employmentType: category(job) === 'internship' ? '实习' : '全职',
      experienceText: job.reqWorkYearsName ?? null,
      educationText: job.reqEducationName ?? null,
      description: `职位描述\n${job.description}\n\n职位要求\n${job.requirement}`,
      detailUrl: `https://hr.163.com/job-detail.html?id=${String(job.id)}&lang=zh`,
      publishedAtMs: job.updateTime ?? null,
      provenance: {
        title: '$.name',
        locations: '$.workPlaceNameList',
        description: '$.description+$.requirement',
      },
      sourcePrivateJson: { productName: job.productName ?? null, beeUrl: job.beeUrl ?? null },
    }),
  });
}
