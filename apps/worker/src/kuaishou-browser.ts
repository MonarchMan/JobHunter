import { setTimeout as delay } from 'node:timers/promises';
import {
  SourceError,
  type SourcePageCollection,
  type SourcePageCollectionRequest,
} from '@jobhunter/source-core';
import {
  invokeKuaishouRuntime,
  kuaishouRuntimeReady,
  kuaishouSite,
  parseKuaishouDictionaries,
  parseKuaishouPage,
  selectKuaishouProject,
  validateKuaishouCollection,
  type KuaishouKey,
} from '@jobhunter/sources';
import type { Page } from 'playwright';
import type { BrowserSourceOptions } from './browser-source.js';

/** Worker 持有浏览器生命周期，来源包只提供无浏览器依赖的官网协议函数。 */
export async function collectKuaishouPages(
  page: Page,
  request: SourcePageCollectionRequest,
  options: BrowserSourceOptions,
): Promise<SourcePageCollection> {
  // 1、限定站点/来源/接口组合，加载不会自动发出职位列表请求的公开首页。
  const site = kuaishouSite(request.sourceKey);
  if (
    request.url !== site.entry ||
    request.listEndpointPath !== site.endpoint ||
    !request.allowedHosts.includes(site.host)
  )
    throw new SourceError('parse_changed', 'Kuaishou browser request identity changed.');
  const key = request.sourceKey as KuaishouKey;
  const size = request.pageSize ?? 50;
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new SourceError('parse_changed', 'Kuaishou page capacity is invalid.');
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(request.operationTimeoutMs ?? 300_000),
  ]);
  const closeOnAbort = (): void => {
    void page.close().catch(() => undefined);
  };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  let lastCall = 0;
  const interval = Math.max(5_000, request.minimumRequestIntervalMs ?? 0);
  /** 单次调用有独立截止时间，结果大小受限；不输出上游请求头、签名或错误正文。 */
  const invoke = async (input: Parameters<typeof invokeKuaishouRuntime>[0]): Promise<unknown> => {
    if (signal.aborted) throw new SourceError('temporary', 'Kuaishou collection was aborted.');
    await delay(Math.max(0, lastCall + interval - Date.now()), undefined, { signal });
    lastCall = Date.now();
    const timer = setTimeout(closeOnAbort, request.timeoutMs);
    try {
      const value = await page.evaluate(invokeKuaishouRuntime, input);
      if (Buffer.byteLength(JSON.stringify(value)) > request.maximumResponseBytes)
        throw new SourceError('parse_changed', 'Kuaishou response exceeds the configured limit.');
      return value;
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError(
        page.isClosed() ? 'temporary' : 'parse_changed',
        'Kuaishou official runtime call failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    if (signal.aborted) throw new SourceError('temporary', 'Kuaishou collection was aborted.');
    await page.goto(site.bootstrap, { waitUntil: 'domcontentloaded', timeout: request.timeoutMs });
    await page
      .waitForFunction(kuaishouRuntimeReady, undefined, { timeout: request.timeoutMs })
      .catch(() => {
        throw new SourceError(
          signal.aborted || page.isClosed() ? 'temporary' : 'parse_changed',
          'Kuaishou official runtime did not become ready.',
        );
      });
    // 2、主站解码字典；校园站动态选择最新对应性质项目，互不借用社会招聘证据。
    const project = site.campus
      ? selectKuaishouProject(await invoke({ campus: true, operation: 'projects' }), site.nature)
      : undefined;
    const dictionaries = site.campus
      ? {}
      : parseKuaishouDictionaries(await invoke({ campus: false, operation: 'dictionaries' }));
    const pages: SourcePageCollection['pages'][number][] = [];
    const read = async (number: number): Promise<number> => {
      const value = await invoke({
        campus: site.campus,
        operation: 'list',
        pageNum: number,
        pageSize: size,
        nature: site.nature,
        ...(project ? { project } : {}),
      });
      const parsed = parseKuaishouPage(value, key, number, size, dictionaries, project);
      pages.push({
        page: number,
        url: site.entry,
        records: parsed.records,
        total: parsed.total,
        capturedAt: Date.now(),
      });
      return parsed.total;
    };
    const total = await read(1);
    const count = Math.max(1, Math.ceil(total / size));
    const limit = Math.max(
      1,
      Math.min(request.maximumPages, options.maximumPages ?? request.maximumPages),
    );
    const sampled = options.pageSampling === 'first-last' && count > limit && limit >= 2;
    // 3、生产顺序翻页；smoke 只读首页和末页（可加中间页），且显式标记 partial。
    const numbers = sampled
      ? [...new Set([1, ...(limit >= 3 ? [Math.ceil(count / 2)] : []), count])]
      : Array.from({ length: Math.min(count, limit) }, (_, index) => index + 1);
    for (const number of numbers.slice(1)) await read(number);
    return validateKuaishouCollection(
      {
        pages,
        coverage: numbers.length < count ? 'partial' : 'complete',
        diagnostics: {
          reason:
            numbers.length < count ? (sampled ? 'sampled_pages' : 'maximum_pages_reached') : null,
          retryable: false,
        },
      },
      key,
      size,
    );
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('temporary', 'Kuaishou browser collection failed.');
  } finally {
    signal.removeEventListener('abort', closeOnAbort);
    await page.close().catch(() => undefined);
  }
}
