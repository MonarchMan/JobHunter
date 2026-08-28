import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  oppoSocialConfigSchema,
  oppoSocialJobSchema,
  oppoSocialListSchema,
  type OppoSocialConfig,
  type OppoSocialJob,
} from './schemas.js';

const hosts = ['career.oppo.com'] as const;
const entryUrl = 'https://career.oppo.com/recruitment/post?recruitType=SOCIAL-RECRUITMENT';

function experience(job: OppoSocialJob): string | null {
  const min = job.minWorkYears;
  const max = job.maxWorkYears;
  if (min === null || min === undefined || max === null || max === undefined) return null;
  if (min === 999 && max === 999) return '经验不限';
  if (min === 999) return `${String(max)}年及以内`;
  if (max === 999) return `${String(min)}年及以上`;
  return `${String(min)}-${String(max)}年`;
}

export function createOppoSocialAdapter(): JobSourceAdapter<OppoSocialConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: 'oppo.social',
      version: '1.0.0',
      company: { slug: 'oppo', name: 'OPPO' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: oppoSocialConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: 'oppo.social',
      requestId,
      url: 'https://career.oppo.com/ats-candidate-api/open-api/position/queryPositionList',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://career.oppo.com',
        referer: entryUrl,
        'tenant-id': '1000',
      },
      body: JSON.stringify({
        pageNum: page,
        pageSize: config.pageSize,
        publishName: config.keyword,
        workCityCodeList: [],
        jobTypeList: [],
        recruitTypeList: ['SOCIAL-RECRUITMENT'],
        shareId: '',
      }),
    }),
    parsePage: (body) => {
      const parsed = oppoSocialListSchema.parse(body).data;
      return { records: parsed.list, total: parsed.total };
    },
    parseRecord: (value) => oppoSocialJobSchema.parse(value),
    fields: (job: OppoSocialJob) => {
      const publishedAtMs = job.publishDate ? Date.parse(job.publishDate) : Number.NaN;
      return {
        externalJobId: job.positionId,
        title: job.jobName,
        department: job.publishName,
        taxonomyText: job.jobName,
        recruitmentCategory: 'social',
        locations: job.workCityName ? [job.workCityName] : [],
        employmentType: job.recruitTypeName ?? '社招',
        experienceText: experience(job),
        educationText: job.educationRequire ?? null,
        description: `岗位职责\n${job.jobDuty}\n\n任职要求\n${job.workRequire}`,
        detailUrl: `https://career.oppo.com/recruitment/post/${job.positionId}?recruitType=SOCIAL-RECRUITMENT`,
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : null,
        provenance: {
          title: '$.jobName',
          locations: '$.workCityName',
          description: '$.jobDuty+$.workRequire',
        },
        sourcePrivateJson: { jobCode: job.jobCode, jobType: job.jobType ?? null },
      };
    },
  });
}
