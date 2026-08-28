import type { JobSourceAdapter } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  neteaseCampusConfigSchema,
  neteaseCampusJobSchema,
  neteaseCampusListSchema,
  neteaseLeihuoJobSchema,
  neteaseLeihuoListSchema,
  type NeteaseCampusConfig,
  type NeteaseCampusJob,
  type NeteaseLeihuoJob,
} from './schemas.js';

function createNeteaseCampusProjectAdapter(options: {
  readonly key: 'netease.campus.internet' | 'netease.campus.games';
  readonly projectId: 102 | 103;
  readonly host: 'campus.163.com' | 'campus.game.163.com';
}): JobSourceAdapter<NeteaseCampusConfig, never> {
  const entryUrl = `https://${options.host}/app/job/position?id=${String(options.projectId)}`;
  const hosts = [options.host, 'campus.163.com'] as const;
  return createInlinePagedJsonAdapter({
    metadata: {
      key: options.key,
      version: '1.0.0',
      company: { slug: 'netease', name: '网易' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: [...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: neteaseCampusConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => {
      const url = new URL(`https://${options.host}/api/campuspc/position/getJobList`);
      url.searchParams.set('pageSize', String(config.pageSize));
      url.searchParams.set('currentPage', String(page));
      url.searchParams.set('projectId', String(options.projectId));
      return {
        sourceKey: options.key,
        requestId,
        url: url.toString(),
        allowedHosts: hosts,
        signal,
        timeoutMs,
        responseType: 'json',
        headers: { referer: entryUrl },
      };
    },
    parsePage: (body) => {
      const parsed = neteaseCampusListSchema.parse(body).data;
      return { records: parsed.list, total: parsed.total };
    },
    parseRecord: (value) => neteaseCampusJobSchema.parse(value),
    fields: (job: NeteaseCampusJob) => ({
      externalJobId: String(job.id),
      title: job.positionName,
      department: null,
      taxonomyText: job.positionTypeName ?? job.positionName,
      recruitmentCategory: 'campus',
      locations: (job.workPlaceName ?? '')
        .split(/[，,、/]/)
        .map((value) => value.trim())
        .filter(Boolean),
      employmentType: '校招',
      description: `岗位职责\n${job.positionDescription}\n\n岗位要求\n${job.positionRequirement}`,
      detailUrl: `https://campus.163.com/app/detail/index?id=${String(job.id)}&projectId=${String(job.projectId)}`,
      publishedAtMs: job.updateTime ?? null,
      provenance: {
        title: '$.positionName',
        locations: '$.workPlaceName',
        description: '$.positionDescription+$.positionRequirement',
      },
    }),
  });
}

export const createNeteaseCampusInternetAdapter = (): JobSourceAdapter<
  NeteaseCampusConfig,
  never
> =>
  createNeteaseCampusProjectAdapter({
    key: 'netease.campus.internet',
    projectId: 103,
    host: 'campus.163.com',
  });

export const createNeteaseCampusGamesAdapter = (): JobSourceAdapter<NeteaseCampusConfig, never> =>
  createNeteaseCampusProjectAdapter({
    key: 'netease.campus.games',
    projectId: 102,
    host: 'campus.game.163.com',
  });

export function createNeteaseCampusLeihuoAdapter(): JobSourceAdapter<NeteaseCampusConfig, never> {
  const hosts = ['xiaozhao.leihuo.netease.com', 'campus.163.com'] as const;
  const entryUrl = 'https://leihuo.163.com/campus/#/full?channel=iSfFmJe';
  return createInlinePagedJsonAdapter({
    metadata: {
      key: 'netease.campus.leihuo',
      version: '1.0.0',
      company: { slug: 'netease', name: '网易' },
      recruitmentType: 'campus',
      canonicalEntryUrl: entryUrl,
      officialHosts: ['leihuo.163.com', ...hosts],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'json' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: neteaseCampusConfigSchema,
    pageSize: (config) => config.pageSize,
    request: ({ config, page, requestId, signal, timeoutMs }) => {
      const url = new URL('https://xiaozhao.leihuo.netease.com/api/apply/job/list/show');
      url.searchParams.set('job_name', config.keyword);
      url.searchParams.set('page_size', String(config.pageSize));
      url.searchParams.set('page_number', String(page));
      url.searchParams.set('project_id', '77');
      return {
        sourceKey: 'netease.campus.leihuo',
        requestId,
        url: url.toString(),
        allowedHosts: hosts,
        signal,
        timeoutMs,
        responseType: 'json',
        headers: { referer: entryUrl },
      };
    },
    parsePage: (body) => {
      const parsed = neteaseLeihuoListSchema.parse(body).data;
      return { records: parsed.apply_job_list, total: parsed.count_number };
    },
    parseRecord: (value) => neteaseLeihuoJobSchema.parse(value),
    fields: (job: NeteaseLeihuoJob) => ({
      externalJobId: job.ehr_job_id,
      title: job.job_name,
      department: job.department_name?.join(' / ') ?? null,
      taxonomyText: job.category_name ?? job.job_name,
      recruitmentCategory: 'campus',
      locations: job.work_place_name ? [job.work_place_name] : [],
      employmentType: '校招',
      description: `岗位职责\n${job.job_description}\n\n岗位要求\n${job.job_requirement}`,
      detailUrl: job.job_detail_url,
      publishedAtMs: null,
      provenance: {
        title: '$.job_name',
        locations: '$.work_place_name',
        description: '$.job_description+$.job_requirement',
      },
      sourcePrivateJson: { jobCode: job.job_code },
    }),
  });
}
