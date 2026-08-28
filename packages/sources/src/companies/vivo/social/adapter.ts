import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  vivoSocialConfigSchema,
  vivoSocialJobSchema,
  vivoSocialListSchema,
  type VivoSocialConfig,
  type VivoSocialJob,
} from './schemas.js';

const hosts = ['hr.vivo.com'] as const;
const entryUrl = 'https://hr.vivo.com/jobs';

function experience(job: VivoSocialJob): string | null {
  if (job.yoe_min < 0 && job.yoe_max < 0) return null;
  if (job.yoe_min > 0 && job.yoe_max < 0) return `${String(job.yoe_min)}年及以上`;
  if (job.yoe_min < 0 && job.yoe_max > 0) return `${String(job.yoe_max)}年及以下`;
  return `${String(job.yoe_min)}-${String(job.yoe_max)}年`;
}

export function createVivoSocialAdapter(): JobSourceAdapter<VivoSocialConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: 'vivo.social',
      version: '1.0.0',
      company: { slug: 'vivo', name: 'vivo' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: vivoSocialConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: 'vivo.social',
      requestId,
      url: 'https://hr.vivo.com/api/social/webSite/portal/page',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://hr.vivo.com',
        referer: entryUrl,
      },
      body: JSON.stringify({
        city_code_list: [],
        company_id: 1,
        group_id: 1,
        user_id: null,
        job_category_id_list: [],
        keyword: config.keyword,
        max_results: config.pageSize,
        page,
        yoe_list: [],
        loading: true,
      }),
    }),
    parsePage: (body) => {
      const parsed = vivoSocialListSchema.parse(body);
      return { records: parsed.data, total: parsed.meta.total };
    },
    parseRecord: (value) => vivoSocialJobSchema.parse(value),
    fields: (job: VivoSocialJob) => {
      const detail = new URL('https://hr.vivo.com/job-detail');
      detail.searchParams.set('_irjc', job.job_category_id);
      detail.searchParams.set('_irjid', job.job_id);
      return {
        externalJobId: job.job_id,
        title: job.job_title,
        department: job.requirement_org_name ?? null,
        taxonomyText: job.job_category ?? job.job_title,
        recruitmentCategory: 'social' as const,
        locations: job.job_location_list.map((location) => location.city),
        employmentType: '全职',
        experienceText: experience(job),
        educationText: job.degree_range_name ?? null,
        description: job.job_desc,
        detailUrl: detail.toString(),
        publishedAtMs: job.publish_timestamp ?? null,
        provenance: {
          title: '$.job_title',
          locations: '$.job_location_list',
          description: '$.job_desc',
        },
        sourcePrivateJson: { jobCode: job.job_code },
      };
    },
  });
}
