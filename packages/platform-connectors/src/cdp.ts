import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PlatformError,
  type PlatformSession,
  type PlatformSessionProvider,
} from '@jobhunter/platform-core';
import { z } from 'zod';
import { BossHttpSession } from './boss.js';
import { ZhilianCampusHttpSession } from './zhilian-recommend.js';
import { ZhilianSearchHttpSession } from './zhilian-search.js';
import { Job51HttpSession } from './job51.js';
import { Job51RequestObserver } from './job51-observer.js';

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  expires: z.number(),
});

/** CDP 只读取指定页上下文；WebSocket 由活动会话持有，避免逐动作重复授权。 */
class CdpSessionProvider implements PlatformSessionProvider {
  /** 协议由装配固定，不接受用户输入的任意站点。 */
  public constructor(private readonly provider: 'boss' | 'zhilian' | '51job') {}

  public async connect(
    input: { readonly portFile: string; readonly targetId: string },
    callerSignal: AbortSignal,
  ): Promise<PlatformSession> {
    // 1、只读取用户选择的调试描述文件，不扫描浏览器配置或磁盘凭据。
    if (
      !path.isAbsolute(input.portFile) ||
      path.basename(input.portFile) !== 'DevToolsActivePort' ||
      !/^[\w-]{1,128}$/.test(input.targetId)
    )
      throw new PlatformError('session_unavailable');
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(120_000)]);
    let socket: WebSocket | undefined;
    let handedOff = false;
    let http: PlatformSession | undefined;
    let onEvent: ((message: unknown) => void) | undefined;
    let rejectObservation: (() => void) | undefined;
    let clearObservation: (() => void) | undefined;
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    let nextId = 0;
    try {
      const data = await readFile(input.portFile, { encoding: 'utf8', signal });
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
      const rejectAll = (): void => {
        rejectObservation?.();
        for (const request of pending.values())
          request.reject(new PlatformError('session_unavailable'));
        pending.clear();
      };
      const abort = (): void => {
        rejectAll();
        http?.disconnect();
        ws.close();
      };
      signal.addEventListener('abort', abort, { once: true });
      ws.addEventListener('close', () => {
        rejectAll();
        clearObservation?.();
        http?.disconnect();
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
        const call = (method: string, params: unknown, sessionId?: string): Promise<unknown> => {
          signal.throwIfAborted();
          let timer: ReturnType<typeof setTimeout>;
          return new Promise<unknown>((resolve, reject) => {
            const id = ++nextId;
            // 2.a、人工确认等待与已授权后的命令超时分离。
            timer = setTimeout(() => {
              pending.delete(id);
              reject(new PlatformError('session_unavailable'));
              abort();
            }, 20_000);
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
          }).finally(() => {
            clearTimeout(timer);
          });
        };
        const targets = z
          .object({
            targetInfos: z.array(
              z.object({ targetId: z.string(), type: z.string(), url: z.string() }),
            ),
          })
          .parse(await call('Target.getTargets', {}));
        const target = targets.targetInfos.find(
          (item) => item.targetId === input.targetId && item.type === 'page',
        );
        const targetUrl = target ? new URL(target.url) : undefined;
        const social =
          targetUrl?.origin === 'https://www.zhaopin.com' && targetUrl.pathname === '/jobs';
        if (
          !target ||
          (this.provider === 'boss'
            ? targetUrl?.origin !== 'https://www.zhipin.com'
            : this.provider === '51job'
              ? targetUrl?.origin !== 'https://we.51job.com' || targetUrl.pathname !== '/pc/search'
              : !social &&
                (targetUrl?.origin !== 'https://xiaoyuan.zhaopin.com' ||
                  targetUrl.pathname !== '/recommend'))
        )
          throw new Error('wrong target');
        const attached = z
          .object({ sessionId: z.string() })
          .parse(await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        // 3、智联按所选页面固定协议；主站需要同次搜索与详情双模板，不读 Cookie。
        if (this.provider === '51job') {
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
          http = await observed;
          rejectObservation = undefined;
          onEvent = undefined;
          await call('Network.disable', {}, attached.sessionId);
        } else {
          // 3.b、BOSS 只读资源时间线与适用 Cookie；保留现有协议。
          const evaluated = z.object({ result: z.object({ value: z.string() }) }).parse(
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
          const url = z.array(z.string()).parse(JSON.parse(evaluated.result.value)).at(-1);
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
          http = new BossHttpSession({ cookies: cookieResult.cookies, observedListUrl: url });
        }
        if (this.provider !== '51job')
          await call('Target.detachFromTarget', { sessionId: attached.sessionId });
        signal.throwIfAborted();
        const session = http;
        // 4、BOSS／智联已 detach；前程无忧仅保留被动监听，均不自动重连或刷新。
        if (ws.readyState !== WebSocket.OPEN) throw new Error('connection closed');
        handedOff = true;
        return {
          readNext: (requestSignal) => session.readNext(requestSignal),
          readDetail: (id, requestSignal) => session.readDetail(id, requestSignal),
          disconnect: () => {
            clearObservation?.();
            session.disconnect();
            ws.close();
          },
        };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    } catch {
      throw new PlatformError('session_unavailable');
    } finally {
      rejectObservation?.();
      rejectObservation = undefined;
      if (!handedOff || this.provider !== '51job') onEvent = undefined;
      for (const request of pending.values())
        request.reject(new PlatformError('session_unavailable'));
      pending.clear();
      if (!handedOff) {
        clearObservation?.();
        http?.disconnect();
        socket?.close();
      }
    }
  }
}

/** 前程无忧采用官网辅助的搜索批次观察，同一连接贯穿用户活动会话。 */
export class Job51CdpSessionProvider extends CdpSessionProvider {
  public constructor() {
    super('51job');
  }
}

/** BOSS 使用资源 URL 与适用 Cookie 初始化独立 HTTP 会话。 */
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
