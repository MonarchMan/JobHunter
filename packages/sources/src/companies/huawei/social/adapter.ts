import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  huaweiSocialConfigSchema,
  huaweiSocialJobSchema,
  huaweiSocialListSchema,
  type HuaweiSocialConfig,
  type HuaweiSocialJob,
} from './schemas.js';

const hosts = ['career.huawei.com'] as const;
const entryUrl = 'https://career.huawei.com/reccampportal/portal5/social-recruitment.html';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createHuaweiSocialAdapter(): JobSourceAdapter<HuaweiSocialConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: 'huawei.social',
      version: '1.0.0',
      company: { slug: 'huawei', name: '华为' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: huaweiSocialConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => {
      const endpoint = new URL(
        `https://career.huawei.com/reccampportal/services/portal/portalpub/getJob/newHr/page/${String(config.pageSize)}/${String(page)}`,
      );
      endpoint.searchParams.set('curPage', String(page));
      endpoint.searchParams.set('pageSize', String(config.pageSize));
      endpoint.searchParams.set('jobFamilyCode', '');
      endpoint.searchParams.set('deptCode', '');
      endpoint.searchParams.set('keywords', config.keyword);
      endpoint.searchParams.set('searchType', '1');
      endpoint.searchParams.set('orderBy', 'P_COUNT_DESC');
      endpoint.searchParams.set('jobType', '1');
      return {
        sourceKey: 'huawei.social',
        requestId,
        url: endpoint.toString(),
        allowedHosts: hosts,
        signal,
        timeoutMs,
        responseType: 'json',
        headers: { referer: entryUrl },
      };
    },
    parsePage: (body) => {
      const parsed = huaweiSocialListSchema.parse(body);
      return { records: parsed.result, total: parsed.pageVO.totalRows };
    },
    parseRecord: (value) => huaweiSocialJobSchema.parse(value),
    fields: (job: HuaweiSocialJob) => ({
      externalJobId: String(job.jobId),
      title: job.jobname,
      department: job.deptName ?? null,
      taxonomyText: job.jobFamilyName ?? job.jobname,
      recruitmentCategory: 'social',
      locations: (job.jobAddress ?? '')
        .split(/[\\，,、/]/)
        .map((value) => value.trim())
        .filter(Boolean),
      employmentType: '社招',
      experienceText:
        job.workYear === null || job.workYear === undefined ? null : `${String(job.workYear)} 年`,
      educationText: job.degree ?? null,
      description: `岗位职责\n${job.mainBusiness}\n\n岗位要求\n${job.jobRequire}`,
      detailUrl: `https://career.huawei.com/reccampportal/portal5/social-recruitment-detail.html?jobId=${String(job.jobId)}&dataSource=${String(job.dataSource)}`,
      publishedAtMs: job.lastUpdateDate ? Date.parse(job.lastUpdateDate) : null,
      provenance: {
        title: '$.jobname',
        locations: '$.jobAddress',
        description: '$.mainBusiness+$.jobRequire',
      },
    }),
  });
}
