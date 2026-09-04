import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  qihoo360CampusConfigSchema,
  qihoo360CampusJobSchema,
  qihoo360CampusListSchema,
  type Qihoo360CampusConfig,
  type Qihoo360CampusJob,
} from './schemas.js';

const hosts = ['360campus.zhiye.com'] as const;

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function createQihoo360CampusChannelAdapter(options: {
  readonly key: 'qihoo360.intern' | 'qihoo360.campus';
  readonly categoryId: '2' | '3';
  readonly category: 'internship' | 'campus';
}): JobSourceAdapter<Qihoo360CampusConfig, never> {
  const route = options.category === 'internship' ? 'intern' : 'campus';
  const entryUrl = `https://360campus.zhiye.com/${route}/jobs`;
  return createInlinePagedJsonAdapter({
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'qihoo360', name: '360' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: qihoo360CampusConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: options.key,
      requestId,
      url: 'https://360campus.zhiye.com/api/Jobad/GetJobAdPageList',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://360campus.zhiye.com',
        referer: entryUrl,
      },
      body: JSON.stringify({
        PageIndex: page - 1,
        PageSize: config.pageSize,
        Category: [options.categoryId],
        KeyWords: config.keyword,
        SpecialType: 0,
        PortalId: '',
        DisplayFields: ['Category', 'Kind', 'LocId', 'WorkWeChatQrCode'],
      }),
    }),
    parsePage: (body) => {
      const parsed = qihoo360CampusListSchema.parse(body);
      return { records: parsed.Data, total: parsed.Count };
    },
    parseRecord: (value) => qihoo360CampusJobSchema.parse(value),
    fields: (job: Qihoo360CampusJob) => {
      const detail = new URL(`https://360campus.zhiye.com/${route}/detail`);
      detail.searchParams.set('jobAdId', job.Id);
      const description = [
        job.Duty?.trim() ? `岗位职责\n${job.Duty.trim()}` : null,
        job.Require?.trim() ? `任职要求\n${job.Require.trim()}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join('\n\n');
      const publishedAtMs = job.ChangeDate ? Date.parse(job.ChangeDate) : Number.NaN;
      return {
        externalJobId: job.Id,
        title: job.JobAdName,
        department: null,
        taxonomyText: job.JobAdName,
        recruitmentCategory: options.category,
        locations: job.LocNames,
        employmentType: options.category === 'internship' ? '实习' : '全职',
        description: description || job.JobAdName,
        detailUrl: detail.toString(),
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : null,
        provenance: {
          title: '$.JobAdName',
          locations: '$.LocNames',
          description: '$.Duty+$.Require',
        },
        sourcePrivateJson: { numericJobAdId: job.JobAdId, category: job.Category },
      };
    },
  });
}

/** 招聘来源适配器实例。 */
export const createQihoo360InternAdapter = (): JobSourceAdapter<Qihoo360CampusConfig, never> =>
  createQihoo360CampusChannelAdapter({
    key: 'qihoo360.intern',
    categoryId: '3',
    category: 'internship',
  });

/** 招聘来源适配器实例。 */
export const createQihoo360CampusAdapter = (): JobSourceAdapter<Qihoo360CampusConfig, never> =>
  createQihoo360CampusChannelAdapter({
    key: 'qihoo360.campus',
    categoryId: '2',
    category: 'campus',
  });
