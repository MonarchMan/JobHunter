import { SourceError, type JobSourceAdapter, type SourcePageClient } from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../shared/paged-json/index.js';
import {
  kuaishouConfigSchema,
  kuaishouSite,
  parseKuaishouJob,
  validateKuaishouCollection,
  type KuaishouConfig,
  type KuaishouKey,
} from './protocol.js';

/** 同公司共享映射，但每个物理来源独立配置、采集、去重和完整性归属。 */
export function createKuaishouAdapter(key: KuaishouKey): JobSourceAdapter<KuaishouConfig, never> {
  // 1、列表内联职责和要求，保留稳定官方详情链接，更新时间不冒充发布日期。
  const site = kuaishouSite(key);
  const unavailable = (): never => {
    throw new SourceError(
      'access_blocked',
      'Kuaishou requires an anonymous official browser runtime.',
    );
  };
  const base = createInlinePagedJsonAdapter({
    metadata: {
      key,
      version: '1.0.0',
      company: { slug: 'kuaishou', name: '快手' },
      recruitmentType: site.channel === 'intern' ? 'mixed' : site.channel,
      canonicalEntryUrl: site.entry,
      officialHosts: [site.host],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'browser' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: kuaishouConfigSchema,
    pageSize: (config) => config.pageSize,
    browser: { listEndpointPath: site.endpoint, responseShape: 'kuaishou-jobs' },
    request: unavailable,
    parsePage: unavailable,
    parseRecord: (value) => parseKuaishouJob(value, key),
    fields: (job) => ({
      externalJobId: job.id,
      title: job.name,
      description: `工作职责\n${job.description}\n\n工作要求\n${job.positionDemand}`,
      detailUrl: `${site.detail}${job.id}`,
      recruitmentCategory: site.channel === 'intern' ? 'internship' : site.channel,
      locations: job.locations,
      employmentType: site.channel === 'intern' ? '实习' : '全职',
      experienceText: job.experienceText,
      taxonomyText: job.categoryName ?? job.name,
      provenance: {
        title: '$.name',
        description: '$.description + $.positionDemand',
        locations: site.campus
          ? '$.workLocationDicts[].name'
          : '$.workLocationsCode + dictionary.workLocation',
        recruitmentCategory: '$.positionNatureCode + source channel',
      },
    }),
  });
  // 2、缺少浏览器立即失败；健康检查只取首页，普通采集逐页串行且有整体超时。
  const client = (
    page: SourcePageClient | undefined,
    size: number,
    health = false,
  ): SourcePageClient => {
    if (!page?.collect) return unavailable();
    const collect = page.collect.bind(page);
    return {
      snapshot: page.snapshot.bind(page),
      collect: async (request) =>
        validateKuaishouCollection(
          await collect({
            ...request,
            timeoutMs: 30_000,
            operationTimeoutMs: 300_000,
            minimumRequestIntervalMs: 5_000,
            ...(health ? { maximumPages: 1 } : {}),
          }),
          key,
          size,
        ),
    };
  };
  return {
    ...base,
    discover: (context) =>
      base.discover({ ...context, page: client(context.page, context.config.pageSize) }),
    healthCheck: (context) =>
      base.healthCheck(
        context.page?.collect
          ? { ...context, page: client(context.page, context.config.pageSize, true) }
          : context,
      ),
  };
}
