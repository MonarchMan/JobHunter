import {
  SourceError,
  type JobSourceAdapter,
  type SourcePageClient,
  type SourcePageCollection,
} from '@jobhunter/source-core';
import { createInlinePagedJsonAdapter } from '../../../shared/paged-json/index.js';
import {
  bilibiliSocialConfigSchema,
  parseBilibiliSocialJob,
  parseBilibiliSocialPage,
  type BilibiliSocialConfig,
} from './schemas.js';

const entryUrl = 'https://jobs.bilibili.com/social/positions';

/** 将官网描述中的 HTML 展示标记转为纯文本，保留段落和换行。 */
export function bilibiliDescriptionText(value: string): string {
  // 1、先去除非正文内容和标签，防止脚本或样式混入匹配文本。
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  // 2、标签去除后解码实体，输出只用于纯文本，不能重新解释为 HTML。
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match: string, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
      const code = entity.toLowerCase().startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 官网日期明确按中国标准时间解析，并拒绝日期溢出。 */
function publishedAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(`${value.replace(' ', 'T')}+08:00`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 19) !== value.replace(' ', 'T')
  ) {
    throw new SourceError('parse_changed', 'Bilibili publication date is invalid.');
  }
  return timestamp;
}

/** 校验 collection 本身，防止浏览器缺页或短页被当成完整同步而关闭旧岗位。 */
function validatedCollection(
  collection: SourcePageCollection,
  pageSize: number,
): SourcePageCollection {
  // 1、只接受已知总数；合法零结果由浏览器解析成功的业务响应提供诊断总数。
  const total = collection.pages[0]?.total ?? collection.diagnostics?.expectedCount;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    throw new SourceError('parse_changed', 'Bilibili collection has no verified total.');
  }
  const ids = new Set<string>();
  const pageNumbers = new Set<number>();
  let duplicateIds = 0;
  let totalChanged = false;
  let invalidBoundary = false;
  const expectedPages = Math.ceil(total / pageSize);
  // 2、逐页检查容量、页码、招聘类型及唯一 ID，同时清理原始记录字段。
  const pages = [];
  for (const page of collection.pages) {
    if (!Number.isSafeInteger(page.page) || page.page < 1)
      throw new SourceError('parse_changed', 'Bilibili page number is invalid.');
    totalChanged ||= page.total !== total;
    invalidBoundary ||=
      pageNumbers.has(page.page) ||
      page.page > expectedPages ||
      page.records.length !== Math.min(pageSize, Math.max(0, total - (page.page - 1) * pageSize));
    pageNumbers.add(page.page);
    const records = page.records.map((value) => {
      const job = parseBilibiliSocialJob(value);
      if (ids.has(job.id)) duplicateIds += 1;
      ids.add(job.id);
      return job;
    });
    pages.push({ ...page, records });
  }
  // 3、仅在页数、记录数、两端总数均闭合时保留 complete；采样不会被升级。
  const missing = pageNumbers.size !== expectedPages || ids.size !== total;
  const reason = totalChanged
    ? 'pagination_total_changed'
    : duplicateIds
      ? 'duplicate_job_ids'
      : invalidBoundary
        ? 'invalid_page_boundary'
        : (collection.diagnostics?.reason ?? (missing ? 'discovered_count_mismatch' : null));
  return {
    ...collection,
    pages,
    coverage:
      totalChanged || duplicateIds > 0 || invalidBoundary || missing
        ? 'partial'
        : collection.coverage,
    diagnostics: {
      ...collection.diagnostics,
      reason,
      retryable: totalChanged,
      expectedCount: total,
      discoveredCount: ids.size,
      expectedPages,
      fetchedPages: pages.length,
      duplicateIds,
      totalChanged,
    },
  };
}

/** 包装已有匿名客户端；无浏览器时立即报错，不发出裸 HTTP 请求。 */
function validatedClient(
  page: SourcePageClient | undefined,
  pageSize: number,
  healthOnly = false,
): SourcePageClient {
  if (!page?.collect)
    throw new SourceError(
      'access_blocked',
      'Bilibili social requires an anonymous browser session.',
    );
  const collect = page.collect.bind(page);
  return {
    snapshot: page.snapshot.bind(page),
    collect: async (request) =>
      validatedCollection(
        await collect({
          ...request,
          minimumRequestIntervalMs: 5_000,
          ...(healthOnly ? { maximumPages: 1 } : {}),
        }),
        pageSize,
      ),
  };
}

/** B 站社招适配器：官网列表内联正文，复用受控浏览器分页与公共归一化。 */
export function createBilibiliSocialAdapter(): JobSourceAdapter<BilibiliSocialConfig, never> {
  // 1、声明公司协议与字段映射；浏览器驱动仅通过契约调用，不反向导入 Worker。
  const base = createInlinePagedJsonAdapter({
    metadata: {
      key: 'bilibili.social',
      version: '1.0.0',
      company: { slug: 'bilibili', name: '哔哩哔哩' },
      recruitmentType: 'social',
      canonicalEntryUrl: entryUrl,
      officialHosts: ['jobs.bilibili.com'],
      capabilities: { detail: 'inline', pagination: 'page', transport: 'browser' },
      defaultRateLimit: { requestsPerMinute: 12, burst: 1 },
      externalIdFingerprintVersion: null,
    },
    configSchema: bilibiliSocialConfigSchema,
    browser: {
      listEndpointPath: '/api/srs/position/positionList',
      responseShape: 'bilibili-social',
    },
    pageSize: (config) => config.pageSize,
    request: () => {
      throw new SourceError(
        'access_blocked',
        'Bilibili social requires an anonymous browser session.',
      );
    },
    parsePage: parseBilibiliSocialPage,
    parseRecord: parseBilibiliSocialJob,
    fields: (job) => {
      const description = bilibiliDescriptionText(job.positionDescription);
      if (!description)
        throw new SourceError('parse_changed', 'Bilibili job description is empty.');
      return {
        externalJobId: job.id,
        title: job.positionName,
        description,
        detailUrl: `${entryUrl}/${job.id}`,
        taxonomyText: job.postCodeName ?? job.positionName,
        recruitmentCategory: 'social' as const,
        locations: job.workLocation
          .split(/[、,，;；/]/)
          .map((item) => item.trim())
          .filter(Boolean),
        employmentType: '全职',
        publishedAtMs: publishedAt(job.pushTime),
        provenance: {
          title: '$.positionName',
          description: '$.positionDescription',
          locations: '$.workLocation',
          publishedAt: '$.pushTime (Asia/Shanghai)',
        },
      };
    },
  });
  // 2、所有发现均经过 collection 校验；复用公共 normalize 与健康结果结构。
  return {
    ...base,
    discover: (context) =>
      base.discover({ ...context, page: validatedClient(context.page, context.config.pageSize) }),
    healthCheck: (context) =>
      base.healthCheck(
        context.page?.collect
          ? {
              ...context,
              page: validatedClient(context.page, context.config.pageSize, true),
            }
          : context,
      ),
  };
}
