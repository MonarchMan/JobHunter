import { setTimeout as delay } from 'node:timers/promises';
import {
  SourceError,
  type SourcePageCollection,
  type SourcePageCollectionRequest,
} from '@jobhunter/source-core';
import {
  didiSites,
  didiMokaRuntimeReady,
  invokeDidiMoka,
  didiPageNumbers,
  parseDidiPage,
  parseDidiMokaJob,
  validateDidiCollection,
} from '@jobhunter/sources';
import type { Page } from 'playwright';
import type { BrowserSourceOptions } from './browser-source.js';

/** 只驱动滴滴官方 Moka 公开列表/详情；页面、超时与清理由 Worker 管理。 */
export async function collectDidiMoka(
  page: Page,
  request: SourcePageCollectionRequest,
  options: BrowserSourceOptions,
): Promise<SourcePageCollection> {
  if (
    request.sourceKey !== 'didi.intern' &&
    request.sourceKey !== 'didi.campus' &&
    request.sourceKey !== 'didi.campus.elite'
  )
    throw new SourceError('parse_changed', 'Unknown Didi browser source.');
  const key = request.sourceKey;
  const site = didiSites[key];
  const detail = request.responseShape === 'didi-moka-detail';
  const id =
    detail && request.url.startsWith(site.detail) ? request.url.slice(site.detail.length) : null;
  if (
    !request.allowedHosts.includes(site.host) ||
    (detail ? !id || !/^[\da-f-]{36}$/i.test(id) : request.url !== site.entry) ||
    request.listEndpointPath !==
      (detail ? '/api/outer/ats-apply/website/job' : '/api/outer/ats-apply/website/jobs/v2') ||
    request.pageSize !== 30
  )
    throw new SourceError('parse_changed', 'Didi browser request identity changed.');
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(request.operationTimeoutMs ?? 300000),
  ]);
  const close = (): void => {
    void page.close().catch(() => undefined);
  };
  signal.addEventListener('abort', close, { once: true });
  // 首次调用也保留冷却，避免 required 详情的连续独立会话绕过分页间隔。
  let last = Date.now();
  /** 单请求有截止时间，外部失败不透传消息或解封后的内部字段。 */
  const invoke = async (input: Parameters<typeof invokeDidiMoka>[0]): Promise<unknown> => {
    if (signal.aborted) throw new SourceError('temporary', 'Didi collection was aborted.');
    await delay(
      Math.max(0, last + Math.max(5000, request.minimumRequestIntervalMs ?? 0) - Date.now()),
      undefined,
      { signal },
    );
    last = Date.now();
    const timer = setTimeout(close, request.timeoutMs);
    try {
      const result = await page.evaluate(invokeDidiMoka, input);
      if (Buffer.byteLength(JSON.stringify(result)) > request.maximumResponseBytes)
        throw new SourceError('parse_changed', 'Didi response exceeds size limit.');
      return result;
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError(
        page.isClosed() ? 'temporary' : 'parse_changed',
        'Didi official client call failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    // 1、无职位列表的公开首页初始化原始客户端，不使用用户 profile 或登录态。
    if (signal.aborted) throw new SourceError('temporary', 'Didi collection was aborted.');
    await page.goto(site.entry.replace('#/jobs', '#/'), {
      waitUntil: 'domcontentloaded',
      timeout: request.timeoutMs,
    });
    if (new URL(page.url()).hostname !== site.host)
      throw new SourceError('access_blocked', 'Didi browser left the official site.');
    await page
      .waitForFunction(didiMokaRuntimeReady, undefined, { timeout: request.timeoutMs })
      .catch(() => {
        throw new SourceError(
          signal.aborted || page.isClosed() ? 'temporary' : 'parse_changed',
          'Didi official runtime did not become ready.',
        );
      });
    // 2、详情集合只允许单个已知 ID；不得遍历候选人、相似职位或投递接口。
    if (detail && id) {
      const job = parseDidiMokaJob(await invoke({ key, operation: 'detail', id }), key, true);
      if (job.id !== id) throw new SourceError('parse_changed', 'Didi detail identity differs.');
      return {
        coverage: 'complete',
        pages: [{ page: 1, url: request.url, records: [job], total: 1, capturedAt: Date.now() }],
      };
    }
    const pages: SourcePageCollection['pages'][number][] = [];
    const read = async (number: number): Promise<number> => {
      const parsed = parseDidiPage(await invoke({ key, operation: 'list', page: number }), key);
      pages.push({
        page: number,
        url: site.entry,
        records: parsed.records,
        total: parsed.total,
        capturedAt: Date.now(),
      });
      return parsed.total;
    };
    // 3、总数与固定容量驱动页码，健康检查最多首页，smoke 保留首尾并标 partial。
    const total = await read(1);
    const maximum = Math.min(request.maximumPages, options.maximumPages ?? request.maximumPages);
    const sampling = request.pageSampling ?? options.pageSampling ?? 'sequential';
    const numbers = didiPageNumbers(total, 30, maximum, sampling);
    for (const number of numbers.slice(1)) await read(number);
    const partial = numbers.length < Math.max(1, Math.ceil(total / 30));
    return validateDidiCollection(
      {
        pages,
        coverage: partial ? 'partial' : 'complete',
        diagnostics: {
          reason: partial
            ? sampling === 'first-last'
              ? 'sampled_pages'
              : 'maximum_pages_reached'
            : null,
          retryable: false,
        },
      },
      key,
      30,
    );
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('temporary', 'Didi browser collection failed.');
  } finally {
    signal.removeEventListener('abort', close);
    await page.close().catch(() => undefined);
  }
}
