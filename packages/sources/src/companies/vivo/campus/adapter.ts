import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  vivoCampusConfigSchema,
  vivoCampusJobSchema,
  vivoCampusListSchema,
  type VivoCampusConfig,
  type VivoCampusJob,
} from './schemas.js';

const hosts = ['hr-campus.vivo.com'] as const;
const entryUrl = 'https://hr-campus.vivo.com/jobs';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function createVivoCampusChannelAdapter(options: {
  readonly key: 'vivo.intern' | 'vivo.campus';
  readonly categoryId: '2' | '3';
  readonly category: 'internship' | 'campus';
}): JobSourceAdapter<VivoCampusConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'vivo', name: 'vivo' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: vivoCampusConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: options.key,
      requestId,
      url: 'https://hr-campus.vivo.com/api/Jobad/GetJobAdPageList',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://hr-campus.vivo.com',
        referer: entryUrl,
      },
      body: JSON.stringify({
        PageIndex: page - 1,
        PageSize: config.pageSize,
        KeyWords: config.keyword,
        SpecialType: 0,
        PortalId: '',
        DisplayFields: ['Category', 'LocId', 'HeadCount', 'WorkWeChatQrCode'],
        Category: options.categoryId,
      }),
    }),
    parsePage: (body) => {
      const parsed = vivoCampusListSchema.parse(body);
      return { records: parsed.Data, total: parsed.Count };
    },
    parseRecord: (value) => vivoCampusJobSchema.parse(value),
    fields: (job: VivoCampusJob) => {
      const detail = new URL(
        `https://hr-campus.vivo.com/${options.category === 'internship' ? 'intern' : 'campus'}/detail`,
      );
      detail.searchParams.set('jobAdId', job.Id);
      const publishedAtMs = job.ChangeDate ? Date.parse(job.ChangeDate) : Number.NaN;
      const description = [
        job.Duty?.trim() ? `岗位职责\n${job.Duty.trim()}` : null,
        job.Require?.trim() ? `任职要求\n${job.Require.trim()}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join('\n\n');
      return {
        externalJobId: job.Id,
        title: job.JobAdName,
        department: null,
        taxonomyText: job.JobAdName,
        recruitmentCategory: options.category,
        locations: job.LocNames,
        employmentType: options.category === 'internship' ? '实习' : '全职',
        experienceText: null,
        educationText: null,
        description: description || job.JobAdName,
        detailUrl: detail.toString(),
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : null,
        provenance: {
          title: '$.JobAdName',
          locations: '$.LocNames',
          description: '$.Duty+$.Require',
        },
        sourcePrivateJson: {
          numericJobAdId: job.JobAdId,
          category: job.Category,
          headCount: job.HeadCount ?? null,
        },
      };
    },
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createVivoInternAdapter(): JobSourceAdapter<VivoCampusConfig, never> {
  return createVivoCampusChannelAdapter({
    key: 'vivo.intern',
    categoryId: '3',
    category: 'internship',
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createVivoCampusAdapter(): JobSourceAdapter<VivoCampusConfig, never> {
  return createVivoCampusChannelAdapter({
    key: 'vivo.campus',
    categoryId: '2',
    category: 'campus',
  });
}
