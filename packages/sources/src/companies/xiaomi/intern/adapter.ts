import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  xiaomiInternConfigSchema,
  xiaomiInternJobSchema,
  xiaomiInternListSchema,
  type XiaomiInternConfig,
  type XiaomiInternJob,
} from './schemas.js';

const hosts = ['hr.xiaomi.com', 'xiaomi.jobs.f.mioffice.cn'] as const;
interface XiaomiChannelOptions {
  readonly key: 'xiaomi.intern' | 'xiaomi.campus' | 'xiaomi.social';
  readonly type: 1 | 2 | 3;
  readonly entryUrl: string;
  readonly recruitmentType: 'campus' | 'social';
  readonly recruitmentCategory: 'internship' | 'campus' | 'social';
  readonly employmentType: '实习' | '校招' | '社招';
}

function createXiaomiChannelAdapter(
  options: XiaomiChannelOptions,
): JobSourceAdapter<XiaomiInternConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'xiaomi', name: '小米' },
      recruitmentType: options.recruitmentType,
      canonicalEntryUrl: options.entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'browser' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: xiaomiInternConfigSchema,
    browser: {
      listEndpointPath: '/website/api/agent/searchJobPage',
      responseShape: 'xiaomi-jobs',
    },
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => {
      const url = new URL('https://hr.xiaomi.com/website/api/agent/searchJobPage');
      url.searchParams.set('keyword', config.keyword);
      url.searchParams.set('cityZhNames', '');
      url.searchParams.set('pageSize', String(config.pageSize));
      url.searchParams.set('pageNum', String(page));
      url.searchParams.set('type', String(options.type));
      return {
        sourceKey: options.key,
        requestId,
        url: url.toString(),
        allowedHosts: hosts,
        signal,
        timeoutMs,
        responseType: 'json',
        headers: { referer: options.entryUrl },
      };
    },
    parsePage: (body) => {
      const parsed = xiaomiInternListSchema.parse(body).data;
      return { records: parsed.list, total: parsed.total };
    },
    parseRecord: (value) => xiaomiInternJobSchema.parse(value),
    fields: (job: XiaomiInternJob) => ({
      externalJobId: job.jobPostId,
      title: job.title,
      department: job.levelOneDeptName ?? null,
      taxonomyText: job.title,
      recruitmentCategory: options.recruitmentCategory,
      locations: job.cityZhNames,
      employmentType: options.employmentType,
      description: `岗位职责\n${job.description}\n\n岗位要求\n${job.requirement}`,
      detailUrl: job.url,
      publishedAtMs: job.publishTime ? Date.parse(job.publishTime) : null,
      provenance: {
        title: '$.title',
        locations: '$.cityZhNames',
        description: '$.description+$.requirement',
      },
      sourcePrivateJson: { jobId: job.jobId, larkJobCode: job.larkJobCode ?? null },
    }),
  });
}

export const createXiaomiInternAdapter = (): JobSourceAdapter<XiaomiInternConfig, never> =>
  createXiaomiChannelAdapter({
    key: 'xiaomi.intern',
    type: 3,
    entryUrl: 'https://hr.xiaomi.com/website/opportunities.html?project=%E5%AE%9E%E4%B9%A0',
    recruitmentType: 'campus',
    recruitmentCategory: 'internship',
    employmentType: '实习',
  });

export const createXiaomiCampusAdapter = (): JobSourceAdapter<XiaomiInternConfig, never> =>
  createXiaomiChannelAdapter({
    key: 'xiaomi.campus',
    type: 2,
    entryUrl: 'https://hr.xiaomi.com/website/opportunities.html?project=%E6%A0%A1%E6%8B%9B',
    recruitmentType: 'campus',
    recruitmentCategory: 'campus',
    employmentType: '校招',
  });

export const createXiaomiSocialAdapter = (): JobSourceAdapter<XiaomiInternConfig, never> =>
  createXiaomiChannelAdapter({
    key: 'xiaomi.social',
    type: 1,
    entryUrl: 'https://hr.xiaomi.com/website/opportunities.html',
    recruitmentType: 'social',
    recruitmentCategory: 'social',
    employmentType: '社招',
  });
