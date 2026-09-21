import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  PlatformError,
  type PlatformSession,
  type PlatformSessionProvider,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { chromePortFile } from './browser-discovery.js';
import { BossHttpSession } from './boss.js';
import { BossBrowserSession } from './boss-browser.js';
import { ZhilianCampusHttpSession } from './zhilian-recommend.js';
import { ZhilianSearchHttpSession } from './zhilian-search.js';
import { Job51HttpSession } from './job51.js';
import { Job51RequestObserver } from './job51-observer.js';
import {
  LiepinRecommendationHttpSession,
  liepinCookieHeader,
  liepinRequestHeaders,
} from './liepin.js';

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  expires: z.number(),
});

/** CDP 默认新建专用页共享登录态；活动会话持有连接，显式目标仅兼容调试。 */
class CdpSessionProvider implements PlatformSessionProvider {
  /** 协议由装配固定，不接受用户输入的任意站点。 */
  public constructor(private readonly provider: 'boss' | 'zhilian' | '51job' | 'liepin') {}

  public async connect(
    input: {
      readonly portFile?: string | undefined;
      readonly targetId?: string | undefined;
      readonly acquisitionMode?: 'http' | 'browser' | undefined;
    },
    callerSignal: AbortSignal,
  ): Promise<PlatformSession> {
    // 1、只读取用户选择的调试描述文件，不扫描浏览器配置或磁盘凭据。
    const browserMode = this.provider === 'boss' && input.acquisitionMode === 'browser';
    const portFile = input.portFile ?? chromePortFile();
    const keepObservation = this.provider === '51job' || browserMode;
    if (
      (input.acquisitionMode !== undefined && this.provider !== 'boss') ||
      !path.isAbsolute(portFile) ||
      path.basename(portFile) !== 'DevToolsActivePort' ||
      (input.targetId !== undefined && !/^[\w-]{1,128}$/.test(input.targetId))
    )
      throw new PlatformError('session_unavailable');
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(120_000)]);
    let socket: WebSocket | undefined;
    let handedOff = false;
    let http: PlatformSession | undefined;
    let onEvent: ((message: unknown) => void) | undefined;
    let rejectObservation: (() => void) | undefined;
    let clearObservation: (() => void) | undefined;
    let release: (() => Promise<void>) | undefined;
    let creatingOwned = false;
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    let nextId = 0;
    try {
      const data = await readFile(portFile, { encoding: 'utf8', signal }).catch(() => {
        throw new PlatformError('session_unavailable', null, 'browser_not_found');
      });
      if (data.length > 1_024) throw new Error('invalid descriptor');
      const [port, endpoint] = data.trim().split(/\r?\n/);
      if (
        !port ||
        !/^\d{1,5}$/.test(port) ||
        Number(port) < 1 ||
        Number(port) > 65535 ||
        !endpoint ||
        !/^\/devtools\/browser\/[\w-]+$/.test(endpoint)
      )
        throw new Error('invalid descriptor');
      signal.throwIfAborted();
      const ws = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
      socket = ws;
      let disconnected = false;
      const disconnectListeners = new Set<() => void>();
      const rejectAll = (): void => {
        rejectObservation?.();
        for (const request of pending.values())
          request.reject(new PlatformError('session_unavailable'));
        pending.clear();
      };
      const abort = (): void => {
        // 2.a、创建命令已发出时短暂等待返回 ID，取消后仍能只清理自己的页。
        if (creatingOwned) return;
        rejectAll();
        http?.disconnect();
        if (release) void release();
        else ws.close();
      };
      signal.addEventListener('abort', abort, { once: true });
      ws.addEventListener('close', () => {
        rejectAll();
        clearObservation?.();
        http?.disconnect();
        // 2.a、底层关闭只通知本地订阅者；不请求官网或建立新连接。
        disconnected = true;
        for (const listener of disconnectListeners) listener();
        disconnectListeners.clear();
      });
      ws.addEventListener('error', abort);
      ws.addEventListener('message', (event) => {
        // 2、CDP 错误原文可能包含 URL，边界只返回固定脱敏错误。
        try {
          if (typeof event.data !== 'string' || event.data.length > 4_000_000)
            throw new Error('invalid message');
          const raw: unknown = JSON.parse(event.data);
          const message = z
            .object({
              id: z.number().optional(),
              result: z.unknown().optional(),
              error: z.unknown().optional(),
            })
            .parse(raw);
          if (message.id === undefined) {
            onEvent?.(raw);
            return;
          }
          const request = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) request?.reject(new PlatformError('session_unavailable'));
          else request?.resolve(message.result);
        } catch {
          rejectAll();
          ws.close();
        }
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const fail = (): void => {
            cleanup();
            reject(new PlatformError('session_unavailable'));
          };
          const ready = (): void => {
            cleanup();
            resolve();
          };
          const cleanup = (): void => {
            signal.removeEventListener('abort', fail);
            ws.removeEventListener('error', fail);
            ws.removeEventListener('close', fail);
            ws.removeEventListener('open', ready);
          };
          ws.addEventListener('open', ready, { once: true });
          ws.addEventListener('error', fail, { once: true });
          ws.addEventListener('close', fail, { once: true });
          signal.addEventListener('abort', fail, { once: true });
          if (signal.aborted) fail();
        });
        const call = (
          method: string,
          params: unknown,
          sessionId?: string,
          operationSignal: AbortSignal = signal,
        ): Promise<unknown> => {
          operationSignal.throwIfAborted();
          let timer: ReturnType<typeof setTimeout>;
          let cancel: (() => void) | undefined;
          return new Promise<unknown>((resolve, reject) => {
            const id = ++nextId;
            cancel = () => {
              pending.delete(id);
              reject(new PlatformError('session_unavailable'));
            };
            operationSignal.addEventListener('abort', cancel, { once: true });
            // 2.a、人工确认等待与已授权后的命令超时分离。
            timer = setTimeout(() => {
              pending.delete(id);
              reject(new PlatformError('session_unavailable'));
              if (operationSignal === signal) abort();
            }, 20_000);
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
          }).finally(() => {
            clearTimeout(timer);
            if (cancel) operationSignal.removeEventListener('abort', cancel);
          });
        };
        const entryUrl = {
          boss: 'https://www.zhipin.com/web/geek/jobs',
          zhilian: 'https://www.zhaopin.com/jobs',
          '51job': 'https://we.51job.com/pc/search',
          liepin: 'https://c.liepin.com/',
        }[this.provider];
        // 2.b、默认只创建自己的页，共享默认配置，不枚举或接管用户页面。
        let ownedTarget: string | undefined;
        let releasing: Promise<void> | undefined;
        release = () => {
          releasing ??= (async () => {
            if (ownedTarget && ws.readyState === WebSocket.OPEN)
              await call(
                'Target.closeTarget',
                { targetId: ownedTarget },
                undefined,
                AbortSignal.timeout(5_000),
              ).catch(() => undefined);
            ws.close();
          })();
          return releasing;
        };
        const targets = input.targetId
          ? z
              .object({
                targetInfos: z.array(
                  z.object({ targetId: z.string(), type: z.string(), url: z.string() }),
                ),
              })
              .parse(await call('Target.getTargets', {}))
          : undefined;
        if (!input.targetId) {
          signal.throwIfAborted();
          creatingOwned = true;
          try {
            ownedTarget = z
              .object({ targetId: z.string().min(1) })
              .parse(
                await call(
                  'Target.createTarget',
                  { url: 'about:blank' },
                  undefined,
                  AbortSignal.timeout(5_000),
                ),
              ).targetId;
          } finally {
            creatingOwned = false;
          }
          signal.throwIfAborted();
        }
        const target = input.targetId
          ? targets?.targetInfos.find(
              (item) => item.targetId === input.targetId && item.type === 'page',
            )
          : ownedTarget
            ? { targetId: ownedTarget, type: 'page', url: entryUrl }
            : undefined;
        if (!target)
          throw new PlatformError('session_unavailable', null, 'platform_page_not_found');
        const targetUrl = new URL(target.url);
        const social =
          targetUrl.origin === 'https://www.zhaopin.com' && targetUrl.pathname === '/jobs';
        if (
          this.provider === 'boss'
            ? targetUrl.origin !== 'https://www.zhipin.com'
            : this.provider === 'liepin'
              ? targetUrl.origin !== 'https://c.liepin.com' || targetUrl.pathname !== '/'
              : this.provider === '51job'
                ? targetUrl.origin !== 'https://we.51job.com' || targetUrl.pathname !== '/pc/search'
                : !social &&
                  (targetUrl.origin !== 'https://xiaoyuan.zhaopin.com' ||
                    targetUrl.pathname !== '/recommend')
        )
          throw new Error('wrong target');
        const attached = z
          .object({ sessionId: z.string() })
          .parse(await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        /** 监听就绪后仅打开一次新页；借用调试页不导航，后续获取不调用此入口。 */
        const openOwnedPage = async (): Promise<void> => {
          if (!ownedTarget) return;
          const result = z
            .object({ errorText: z.string().optional() })
            .parse(await call('Page.navigate', { url: entryUrl }, attached.sessionId));
          if (result.errorText) throw new PlatformError('session_unavailable');
        };
        // 3、智联按所选页面固定协议；主站需要同次搜索与详情双模板，不读 Cookie。
        if (browserMode) {
          if (targetUrl.pathname !== '/web/geek/jobs')
            throw new PlatformError('session_unavailable');
          // 3.a、显式浏览器模式不读 Cookie；仅保留所选页固定端点的观察。
          const browser = new BossBrowserSession({
            sessionId: attached.sessionId,
            call: (method, params, operationSignal) =>
              call(method, params, attached.sessionId, operationSignal),
            clickJob: async (jobId, operationSignal) => {
              if (!/^[\w~-]{1,512}$/.test(jobId)) throw new PlatformError('session_unavailable');
              // 3.a.i、只触发本批职位链接的普通点击，不执行官网私有方法或安全脚本。
              const result = z.object({ result: z.object({ value: z.literal(true) }) });
              result.parse(
                await call(
                  'Runtime.evaluate',
                  {
                    expression: `(() => { if (location.origin !== "https://www.zhipin.com" || location.pathname !== "/web/geek/jobs") return false; const path = ${JSON.stringify(`/job_detail/${jobId}.html`)}; const link = [...document.querySelectorAll('a[href]')].find(a => { const u = new URL(a.href, location.href); return u.origin === location.origin && u.pathname === path && a.getClientRects().length > 0; }); if (!link) return false; link.click(); return true; })()`,
                    returnByValue: true,
                  },
                  attached.sessionId,
                  operationSignal,
                ),
              );
            },
          });
          http = browser;
          onEvent = (message) => {
            browser.accept(message);
          };
          clearObservation = () => {
            onEvent = undefined;
            browser.disconnect();
          };
          await call('Page.enable', {}, attached.sessionId);
          await call(
            'Network.enable',
            { maxTotalBufferSize: 4 * 1024 * 1024, maxResourceBufferSize: 2 * 1024 * 1024 },
            attached.sessionId,
          );
          await openOwnedPage();
        } else if (this.provider === 'liepin') {
          // 3.a、只观察一次正常推荐请求，后续 HTTP 借用 Cookie 而不持续操作页面。
          const observed = new Promise<PlatformSession>((resolve, reject) => {
            rejectObservation = () => {
              reject(new PlatformError('session_unavailable'));
            };
            onEvent = (raw) => {
              const event = z
                .object({
                  sessionId: z.string(),
                  method: z.string(),
                  params: z.object({
                    request: z
                      .object({
                        method: z.string(),
                        url: z.string(),
                        headers: z.record(z.string(), z.string()),
                        postData: z.string().max(20000).optional(),
                      })
                      .optional(),
                  }),
                })
                .safeParse(raw);
              if (
                !event.success ||
                event.data.sessionId !== attached.sessionId ||
                event.data.method !== 'Network.requestWillBeSent'
              )
                return;
              const request = event.data.params.request;
              if (
                request?.method !== 'POST' ||
                request.url !==
                  'https://api-c.liepin.com/api/com.liepin.csearch.home-recommend-job-new' ||
                !request.postData
              )
                return;
              try {
                const headers = liepinRequestHeaders(request.headers);
                const session = new LiepinRecommendationHttpSession({
                  template: { url: request.url, body: request.postData },
                  readHeaders: async (url, operationSignal) => {
                    // 3.a.i、所选页离开首页时不借用别的标签或沿用旧 Cookie。
                    const current = z
                      .object({
                        targetInfos: z.array(z.object({ targetId: z.string(), url: z.string() })),
                      })
                      .parse(await call('Target.getTargets', {}, undefined, operationSignal));
                    const page = current.targetInfos.find(
                      (item) => item.targetId === target.targetId,
                    );
                    if (
                      !page ||
                      new URL(page.url).origin !== 'https://c.liepin.com' ||
                      new URL(page.url).pathname !== '/'
                    )
                      throw new PlatformError('session_unavailable');
                    const temporary = z
                      .object({ sessionId: z.string() })
                      .parse(
                        await call(
                          'Target.attachToTarget',
                          { targetId: target.targetId, flatten: true },
                          undefined,
                          operationSignal,
                        ),
                      );
                    try {
                      const result = z
                        .object({ cookies: z.array(cookieSchema).max(200) })
                        .parse(
                          await call(
                            'Network.getCookies',
                            { urls: [url] },
                            temporary.sessionId,
                            operationSignal,
                          ),
                        );
                      operationSignal.throwIfAborted();
                      const cookie = liepinCookieHeader(result.cookies, url, Date.now());
                      if (!cookie) throw new PlatformError('session_unavailable');
                      return { ...headers, cookie };
                    } finally {
                      await call(
                        'Target.detachFromTarget',
                        { sessionId: temporary.sessionId },
                        undefined,
                        AbortSignal.timeout(5000),
                      ).catch(() => undefined);
                    }
                  },
                });
                onEvent = undefined;
                resolve(session);
              } catch {
                reject(new PlatformError('parse_changed'));
              }
            };
          });
          void observed.catch(() => undefined);
          await call('Network.enable', {}, attached.sessionId);
          await openOwnedPage();
          http = await observed;
        } else if (this.provider === '51job') {
          // 3.a、仅此平台保留所选页监听；用户正常翻页提供新模板，不自动操作网页。
          const session = new Job51HttpSession();
          http = session;
          const observer = new Job51RequestObserver(attached.sessionId, session);
          onEvent = (message) => {
            observer.accept(message);
          };
          clearObservation = () => {
            onEvent = undefined;
            observer.clear();
          };
          await call('Network.enable', {}, attached.sessionId);
          await openOwnedPage();
        } else if (this.provider === 'zhilian') {
          const observed = new Promise<PlatformSession>((resolve, reject) => {
            let listTemplate:
              { url: string; headers: Record<string, string>; body: string } | undefined;
            let detailTemplate: { url: string; headers: Record<string, string> } | undefined;
            rejectObservation = () => {
              reject(new PlatformError('session_unavailable'));
            };
            onEvent = (raw) => {
              const event = z
                .object({
                  sessionId: z.string().optional(),
                  method: z.string().optional(),
                  params: z
                    .object({
                      request: z
                        .object({
                          method: z.string(),
                          url: z.string(),
                          headers: z.record(z.string(), z.string()),
                          postData: z.string().optional(),
                        })
                        .optional(),
                    })
                    .optional(),
                })
                .safeParse(raw);
              if (
                !event.success ||
                event.data.sessionId !== attached.sessionId ||
                event.data.method !== 'Network.requestWillBeSent'
              )
                return;
              const request = event.data.params?.request;
              if (!request) return;
              const url = new URL(request.url);
              if (social) {
                if (url.origin !== 'https://fe-api.zhaopin.com') return;
                try {
                  if (request.method === 'POST' && url.pathname === '/c/i/search/positions') {
                    if (!request.postData || Buffer.byteLength(request.postData, 'utf8') > 32768)
                      throw new Error('Invalid body');
                    if (
                      !z.object({ pageIndex: z.literal(1) }).safeParse(JSON.parse(request.postData))
                        .success
                    )
                      return;
                    // 3.a、首次首页模板固定筛选，不让后续页面请求替换工作集。
                    listTemplate ??= {
                      url: request.url,
                      headers: request.headers,
                      body: request.postData,
                    };
                  } else if (
                    request.method === 'GET' &&
                    url.pathname === '/c/i/jobs/position-detailv3'
                  ) {
                    detailTemplate ??= { url: request.url, headers: request.headers };
                  } else return;
                  if (listTemplate && detailTemplate) {
                    const session = new ZhilianSearchHttpSession({
                      templates: { list: listTemplate, detail: detailTemplate },
                    });
                    onEvent = undefined;
                    resolve(session);
                  }
                } catch {
                  rejectObservation?.();
                }
                return;
              }
              if (request.method !== 'POST') return;
              if (
                url.origin !== 'https://cgate.zhaopin.com' ||
                url.pathname !==
                  '/positionbusiness/searchRecommendCampus/searchRecommendCampusPcSubject'
              )
                return;
              try {
                if (!request.postData || Buffer.byteLength(request.postData, 'utf8') > 32_768)
                  throw new Error('invalid body');
                const body: unknown = JSON.parse(request.postData);
                if (!z.object({ pageIndex: z.literal(1) }).safeParse(body).success) return;
                const session = new ZhilianCampusHttpSession({
                  template: {
                    url: request.url,
                    headers: request.headers,
                    body: request.postData,
                  },
                });
                onEvent = undefined;
                resolve(session);
              } catch {
                rejectObservation?.();
              }
            };
          });
          // 3.a、立即安装失败处理，避免 Network.enable 失败时留下未处理拒绝。
          void observed.catch(() => undefined);
          await call('Network.enable', { maxPostDataSize: 32_768 }, attached.sessionId);
          await openOwnedPage();
          http = await observed;
          rejectObservation = undefined;
          onEvent = undefined;
          await call('Network.disable', {}, attached.sessionId);
        } else {
          // 3.b、BOSS 只读资源时间线与适用 Cookie；保留现有协议。
          await openOwnedPage();
          // 3.b.i、新页仅轮询本地资源时间线，等待自然加载；不刷新或重发官网请求。
          let url: string | undefined;
          for (let attempt = 0; attempt < (ownedTarget ? 60 : 1); attempt++) {
            const evaluated = z.object({ result: z.object({ value: z.string() }) }).safeParse(
              await call(
                'Runtime.evaluate',
                {
                  expression:
                    'JSON.stringify(performance.getEntriesByType("resource").map(x=>x.name).filter(x=>{try{const u=new URL(x);return u.origin==="https://www.zhipin.com"&&u.pathname==="/wapi/zpgeek/pc/recommend/job/list.json"}catch{return false}}))',
                  returnByValue: true,
                },
                attached.sessionId,
              ),
            );
            if (evaluated.success)
              url = z.array(z.string()).parse(JSON.parse(evaluated.data.result.value)).at(-1);
            if (url) break;
            if (ownedTarget) await delay(500, undefined, { signal });
          }
          if (!url) throw new Error('no observed list');
          const cookieResult = z
            .object({ cookies: z.array(cookieSchema).max(200) })
            .parse(
              await call(
                'Network.getCookies',
                { urls: [url, 'https://www.zhipin.com/wapi/zpgeek/job/detail.json'] },
                attached.sessionId,
              ),
            );
          http = new BossHttpSession({
            cookies: cookieResult.cookies,
            observedListUrl: url,
            readContext: async (requestSignal) => {
              // 3.b.i、每次读取前重新确认原目标仍为 BOSS 同源页，禁止跨站取凭据。
              const currentTargets = z
                .object({
                  targetInfos: z.array(
                    z.object({
                      targetId: z.string(),
                      type: z.string(),
                      url: z.string(),
                    }),
                  ),
                })
                .parse(await call('Target.getTargets', {}, undefined, requestSignal));
              const current = currentTargets.targetInfos.find(
                (item) => item.targetId === target.targetId && item.type === 'page',
              );
              if (!current || new URL(current.url).origin !== 'https://www.zhipin.com')
                throw new PlatformError('session_unavailable');
              const temporary = z
                .object({ sessionId: z.string() })
                .parse(
                  await call(
                    'Target.attachToTarget',
                    { targetId: target.targetId, flatten: true },
                    undefined,
                    requestSignal,
                  ),
                );
              try {
                // 3.b.ii、仅只读页面普通认证字段，不调用官网函数或操作 DOM。
                const evaluatedToken = z
                  .object({ result: z.object({ value: z.string().min(1).max(8_192) }) })
                  .parse(
                    await call(
                      'Runtime.evaluate',
                      {
                        expression:
                          'location.origin === "https://www.zhipin.com" && typeof window._PAGE?.token === "string" ? window._PAGE.token.split("|")[0] : null',
                        returnByValue: true,
                      },
                      temporary.sessionId,
                      requestSignal,
                    ),
                  );
                const refreshed = z
                  .object({ cookies: z.array(cookieSchema).max(200) })
                  .parse(
                    await call(
                      'Network.getCookies',
                      { urls: [url, 'https://www.zhipin.com/wapi/zpgeek/job/detail.json'] },
                      temporary.sessionId,
                      requestSignal,
                    ),
                  );
                requestSignal.throwIfAborted();
                return {
                  cookies: refreshed.cookies,
                  token: evaluatedToken.result.value,
                };
              } catch {
                throw new PlatformError('session_unavailable');
              } finally {
                // 3.b.iii、取消后也释放临时 attach，不关闭用户授权的底层连接。
                await call(
                  'Target.detachFromTarget',
                  { sessionId: temporary.sessionId },
                  undefined,
                  AbortSignal.timeout(5_000),
                ).catch(() => undefined);
              }
            },
          });
        }
        if (!keepObservation)
          await call('Target.detachFromTarget', { sessionId: attached.sessionId });
        signal.throwIfAborted();
        const session = http;
        const resume =
          this.provider === 'boss' && input.acquisitionMode !== 'browser'
            ? session.resume?.bind(session)
            : undefined;
        // 4、仅显式观察模式保留页面 session；所有模式均不自动重连或刷新。
        if (ws.readyState !== WebSocket.OPEN) throw new Error('connection closed');
        handedOff = true;
        return {
          onDisconnected: (listener) => {
            if (disconnected || ws.readyState !== WebSocket.OPEN) listener();
            else disconnectListeners.add(listener);
            return () => {
              disconnectListeners.delete(listener);
            };
          },
          readNext: (requestSignal) => session.readNext(requestSignal),
          readDetail: (id, requestSignal) => session.readDetail(id, requestSignal),
          ...(resume ? { resume } : {}),
          disconnect: () => {
            clearObservation?.();
            session.disconnect();
            void release?.();
          },
        };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError('session_unavailable');
    } finally {
      rejectObservation?.();
      rejectObservation = undefined;
      if (!handedOff || !keepObservation) onEvent = undefined;
      if (!handedOff) {
        clearObservation?.();
        http?.disconnect();
        await release?.();
        socket?.close();
      }
      for (const request of pending.values())
        request.reject(new PlatformError('session_unavailable'));
      pending.clear();
    }
  }
}

/** 猎聘只借用首页查询和实时登录上下文，列表与详情使用独立 HTTP。 */
export class LiepinCdpSessionProvider extends CdpSessionProvider {
  /** 固定猎聘学生首页协议，不接受任意站点或搜索模板。 */
  public constructor() {
    super('liepin');
  }
}

/** 前程无忧采用官网辅助的搜索批次观察，同一连接贯穿用户活动会话。 */
export class Job51CdpSessionProvider extends CdpSessionProvider {
  public constructor() {
    super('51job');
  }
}

/** BOSS 固定资源 URL，并在 HTTP 前只读同一浏览器的最小认证上下文。 */
export class BossCdpSessionProvider extends CdpSessionProvider {
  public constructor() {
    super('boss');
  }
}

/** 智联按目标页面选择校园推荐或主站搜索，仅借用正常浏览产生的请求模板。 */
export class ZhilianCdpSessionProvider extends CdpSessionProvider {
  public constructor() {
    super('zhilian');
  }
}
