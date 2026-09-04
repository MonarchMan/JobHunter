import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  oppoInternConfigSchema,
  oppoInternJobSchema,
  oppoInternListSchema,
  type OppoInternConfig,
  type OppoInternJob,
} from './schemas.js';

const hosts = ['careers.oppo.com'] as const;
const entryUrl = 'https://careers.oppo.com/university/oppo/campus/post';

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
function createOppoCampusChannelAdapter(options: {
  readonly key: 'oppo.intern' | 'oppo.campus';
  readonly projects: readonly {
    readonly projectId: 29 | 30 | 31;
    readonly recruitmentType: 'Intern' | 'Graduate' | 'doctor';
  }[];
  readonly category: 'internship' | 'campus';
}): JobSourceAdapter<OppoInternConfig, never> {
  return createInlinePagedJsonAdapter({
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'oppo', name: 'OPPO' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: oppoInternConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => ({
      sourceKey: options.key,
      requestId,
      url: 'https://careers.oppo.com/openapi/position/pageNew',
      allowedHosts: hosts,
      signal,
      timeoutMs,
      method: 'POST',
      responseType: 'json',
      headers: {
        'content-type': 'application/json',
        origin: 'https://careers.oppo.com',
        referer: entryUrl,
      },
      body: JSON.stringify({
        pageNum: page,
        pageSize: config.pageSize,
        positionName: config.keyword,
        projectList: options.projects.map((project) => ({
          ...project,
          isAllNode: 'Y',
          themeList: [],
        })),
        positionTypeList: [],
        workCityCodeList: [],
        shareId: '',
      }),
    }),
    parsePage: (body) => {
      const parsed = oppoInternListSchema.parse(body).data;
      return { records: parsed.records, total: parsed.total };
    },
    parseRecord: (value) => oppoInternJobSchema.parse(value),
    fields: (job: OppoInternJob) => ({
      externalJobId: String(job.idRecruitPosition),
      title: job.positionName,
      taxonomyText: job.positionTypeName ?? job.positionName,
      recruitmentCategory: options.category,
      locations: job.workCityName ? [job.workCityName] : [],
      employmentType: job.recruitmentTypeName,
      description: `岗位职责\n${job.positionDesc}\n\n任职要求\n${job.positionRequire}`,
      detailUrl: `https://careers.oppo.com/university/oppo/campus/post/${String(job.idRecruitPosition)}?recruitType=${job.recruitmentType}`,
      publishedAtMs:
        job.releaseTime && Number.isFinite(Date.parse(job.releaseTime))
          ? Date.parse(job.releaseTime)
          : null,
      provenance: {
        title: '$.positionName',
        locations: '$.workCityName',
        description: '$.positionDesc+$.positionRequire',
      },
      sourcePrivateJson: {
        projectName: job.projectName,
        atsProjectPositionId: job.atsProjectPositionId,
      },
    }),
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createOppoInternAdapter(): JobSourceAdapter<OppoInternConfig, never> {
  return createOppoCampusChannelAdapter({
    key: 'oppo.intern',
    projects: [{ projectId: 29, recruitmentType: 'Intern' }],
    category: 'internship',
  });
}

/** 执行来源数据的解析、转换、请求或分页逻辑。 */
export function createOppoCampusAdapter(): JobSourceAdapter<OppoInternConfig, never> {
  return createOppoCampusChannelAdapter({
    key: 'oppo.campus',
    projects: [
      { projectId: 30, recruitmentType: 'Graduate' },
      { projectId: 31, recruitmentType: 'doctor' },
    ],
    category: 'campus',
  });
}
