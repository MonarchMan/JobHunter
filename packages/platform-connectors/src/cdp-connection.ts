import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PlatformError } from '@jobhunter/platform-core';
import { z } from 'zod';

/** 命令属于租约而非平台全局；取消时只拒绝该租约的在途响应。 */
interface PendingCommand {
  readonly owner: CdpConnectionLease;
  readonly method: string;
  readonly params: unknown;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

/** Worker 拥有的浏览器连接表，不使用跨进程或模块级单例。 */
export class CdpConnectionManager {
  readonly #connections = new Map<string, CdpConnection>();
  #closed = false;

  /** 同端点并发等待共用一个 Socket；调用者取消不撤销其他等待者。 */
  public async acquire(portFile: string, signal: AbortSignal): Promise<CdpConnectionLease> {
    // 1、仅接受本机调试描述文件；路径和端点不进入错误或日志。
    if (!path.isAbsolute(portFile) || path.basename(portFile) !== 'DevToolsActivePort')
      throw new PlatformError('session_unavailable');
    const data = await readFile(portFile, { encoding: 'utf8', signal }).catch(() => {
      throw new PlatformError('session_unavailable', null, 'browser_not_found');
    });
    const [port, endpoint] = data.trim().split(/\r?\n/);
    if (
      data.length > 1024 ||
      !port ||
      !/^\d{1,5}$/.test(port) ||
      Number(port) < 1 ||
      Number(port) > 65535 ||
      !endpoint ||
      !/^\/devtools\/browser\/[\w-]+$/.test(endpoint) ||
      signal.aborted ||
      this.#closed
    )
      throw new PlatformError('session_unavailable');
    const url = `ws://127.0.0.1:${port}${endpoint}`;
    // 2、登记连接与创建租约之间不 await，避免并发初始化重复申请授权。
    let connection = this.#connections.get(url);
    if (!connection) {
      connection = new CdpConnection(url, () => {
        if (this.#connections.get(url) === connection) this.#connections.delete(url);
      });
      this.#connections.set(url, connection);
    }
    const lease = connection.lease();
    try {
      await lease.waitReady(signal);
      return lease;
    } catch {
      await lease.release();
      throw new PlatformError('session_unavailable');
    }
  }

  /** 退出时先完成各租约的有界页面清理，再关闭 Socket；不关闭 Chrome。 */
  public async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#connections.values()].map((connection) => connection.dispose()));
    this.#connections.clear();
  }
}

/** 一个平台／关键词的连接租约，只能收到自己的页面事件和命令结果。 */
export class CdpConnectionLease {
  #released = false;
  #lost = false;
  #releasing: Promise<void> | undefined;
  #cleanup: (() => Promise<void>) | undefined;
  #onEvent: ((message: unknown) => void) | undefined;
  readonly #listeners = new Set<() => void>();

  public constructor(private readonly connection: CdpConnection) {}

  public get available(): boolean {
    return !this.#released && !this.#releasing && !this.#lost && this.connection.open;
  }

  /** 授权等待只受当前调用者取消控制，不将其 AbortSignal 绑定到 Socket。 */
  public waitReady(signal: AbortSignal): Promise<void> {
    let abort: () => void;
    return new Promise<void>((resolve, reject) => {
      abort = () => {
        reject(new PlatformError('session_unavailable'));
      };
      signal.addEventListener('abort', abort, { once: true });
      void this.connection.ready.then(resolve, reject);
      if (signal.aborted) abort();
    }).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  }

  /** 只允许受信任平台实现调用；认证及响应原文不进入日志。 */
  public call(
    method: string,
    params: unknown,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    // 1、释放期间仅供已注册的页面清理使用；业务采集器在清理前已停止。
    if (this.#released || !this.connection.open || (this.#lost && !this.#releasing))
      return Promise.reject(new PlatformError('session_unavailable'));
    return this.connection.call(this, method, params, sessionId, signal);
  }

  /** 页面清理由提供器注册，管理器退出也必须遵守其页面所有权。 */
  public setCleanup(cleanup: () => Promise<void>): void {
    this.#cleanup = cleanup;
  }

  /** 租约只保留一个观察入口；平台内部决定保留哪些协议监听。 */
  public observe(listener: (message: unknown) => void): void {
    this.#onEvent = listener;
  }

  /** 迟到订阅立即通知失效；普通释放不传播给其他租约。 */
  public onDisconnected(listener: () => void): () => void {
    if (!this.available) listener();
    else this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 观察器异常局限于自身，不能破坏其他页面的响应分发。 */
  public accept(message: unknown): void {
    if (!this.available || this.#releasing) return;
    try {
      this.#onEvent?.(message);
    } catch {
      this.invalidate();
    }
  }

  /** 物理断线同步广播一次，并清除内存中的监听及业务上下文。 */
  public invalidate(): void {
    if (this.#lost || this.#released) return;
    this.#lost = true;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        /* 单个订阅者不得阻断其余租约的失效通知。 */
      }
    }
    void this.release();
  }

  /** 幂等释放自身页面、attach 和命令；共享的空闲 Socket 保持打开。 */
  public release(): Promise<void> {
    this.#releasing ??= Promise.resolve().then(async () => {
      // 1、先停止事件与在途命令，再执行提供器注册的页面所有权清理。
      this.#onEvent = undefined;
      this.#listeners.clear();
      this.connection.cancel(this);
      try {
        await this.#cleanup?.();
      } catch {
        /* 断线时不能为了清理重新建连。 */
      }
      // 2、借用页及临时 attach 也须 detach，不能靠关闭共享 Socket 隐式释放。
      await this.connection.detach(this);
      this.#released = true;
      this.#cleanup = undefined;
      this.connection.remove(this);
    });
    return this.#releasing;
  }
}

/** 单个浏览器 WebSocket 的命令复用与 sessionId 路由，不含职位业务状态。 */
class CdpConnection {
  readonly #socket: WebSocket;
  readonly #leases = new Set<CdpConnectionLease>();
  readonly #sessions = new Map<string, CdpConnectionLease>();
  readonly #pending = new Map<number, PendingCommand>();
  readonly #lateResources = new Map<
    number,
    {
      readonly owner: CdpConnectionLease;
      readonly method: string;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  #nextId = 0;
  #opened = false;
  #closed = false;
  readonly ready: Promise<void>;

  public constructor(url: string, onClosed: () => void) {
    this.#socket = new WebSocket(url);
    this.ready = new Promise<void>((resolve, reject) => {
      this.#socket.addEventListener(
        'open',
        () => {
          this.#opened = true;
          resolve();
        },
        { once: true },
      );
      const lost = (): void => {
        if (this.#closed) return;
        this.#closed = true;
        reject(new PlatformError('session_unavailable'));
        for (const request of this.#pending.values())
          request.reject(new PlatformError('session_unavailable'));
        this.#pending.clear();
        for (const resource of this.#lateResources.values()) clearTimeout(resource.timer);
        this.#lateResources.clear();
        this.#sessions.clear();
        onClosed();
        for (const lease of this.#leases) lease.invalidate();
      };
      this.#socket.addEventListener('close', lost);
      this.#socket.addEventListener('error', () => {
        lost();
        this.#socket.close();
      });
    });
    void this.ready.catch(() => undefined);
    this.#socket.addEventListener('message', (event) => {
      try {
        // 1、只校验传输信封，正文仍交由各平台在自身边界解析。
        if (typeof event.data !== 'string' || event.data.length > 4_000_000)
          throw new Error('invalid message');
        const raw: unknown = JSON.parse(event.data);
        const message = z
          .object({
            id: z.number().optional(),
            sessionId: z.string().optional(),
            result: z.unknown().optional(),
            error: z.unknown().optional(),
          })
          .parse(raw);
        if (message.id === undefined) {
          if (message.sessionId) this.#sessions.get(message.sessionId)?.accept(raw);
          return;
        }
        // 1.a、取消后的新页／attach 可能迟到，只有界清理其资源，不交付业务响应。
        const late = this.#lateResources.get(message.id);
        if (late) {
          clearTimeout(late.timer);
          this.#lateResources.delete(message.id);
          if (message.error) return;
          const resource = z
            .object({ sessionId: z.string().optional(), targetId: z.string().optional() })
            .safeParse(message.result);
          if (!resource.success) return;
          const { sessionId, targetId } = resource.data;
          if (
            late.method === 'Target.attachToTarget' &&
            sessionId &&
            !this.#sessions.has(sessionId)
          )
            void this.call(
              late.owner,
              'Target.detachFromTarget',
              { sessionId },
              undefined,
              AbortSignal.timeout(5000),
            ).catch(() => undefined);
          else if (late.method === 'Target.createTarget' && targetId)
            void this.call(
              late.owner,
              'Target.closeTarget',
              { targetId },
              undefined,
              AbortSignal.timeout(5000),
            ).catch(() => undefined);
          return;
        }
        const request = this.#pending.get(message.id);
        if (!request) return;
        this.#pending.delete(message.id);
        if (message.error) {
          request.reject(new PlatformError('session_unavailable'));
          return;
        }
        // 2、attach 响应交付前就登记路由，避免同轮到达的首页事件丢失。
        if (request.method === 'Target.attachToTarget') {
          const attached = z.object({ sessionId: z.string() }).safeParse(message.result);
          if (attached.success) this.#sessions.set(attached.data.sessionId, request.owner);
        } else if (request.method === 'Target.detachFromTarget') {
          const detached = z.object({ sessionId: z.string() }).safeParse(request.params);
          if (detached.success) this.#sessions.delete(detached.data.sessionId);
        }
        request.resolve(message.result);
      } catch {
        this.#socket.close();
      }
    });
  }

  public get open(): boolean {
    return !this.#closed && this.#socket.readyState === WebSocket.OPEN;
  }

  /** 创建独立租约，不因新增平台再次建立 Socket。 */
  public lease(): CdpConnectionLease {
    const lease = new CdpConnectionLease(this);
    this.#leases.add(lease);
    return lease;
  }

  /** 单连接内命令 ID 唯一；取消或超时不关闭其他租约的传输。 */
  public call(
    owner: CdpConnectionLease,
    method: string,
    params: unknown,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!this.open || signal.aborted || (sessionId && this.#sessions.get(sessionId) !== owner))
      return Promise.reject(new PlatformError('session_unavailable'));
    // 1、浏览器级 detach 的 sessionId 在参数中，也不能撤销其他租约的页面监听。
    if (method === 'Target.detachFromTarget') {
      const detached = z.object({ sessionId: z.string() }).safeParse(params);
      const attachedOwner = detached.success
        ? this.#sessions.get(detached.data.sessionId)
        : undefined;
      if (attachedOwner && attachedOwner !== owner)
        return Promise.reject(new PlatformError('session_unavailable'));
    }
    // 2、每条命令的取消和超时只处理自己的 pending 项。
    const id = ++this.#nextId;
    let timer: ReturnType<typeof setTimeout>;
    let cancel: () => void;
    return new Promise<unknown>((resolve, reject) => {
      cancel = () => {
        const request = this.#pending.get(id);
        if (request) this.rememberLateResource(id, request);
        this.#pending.delete(id);
        reject(new PlatformError('session_unavailable'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, 20_000);
      this.#pending.set(id, { owner, method, params, resolve, reject });
      try {
        this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch {
        cancel();
      }
    }).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    });
  }

  /** 清除一个租约的在途命令，迟到响应因 ID 缺失被忽略。 */
  public cancel(owner: CdpConnectionLease): void {
    for (const [id, request] of this.#pending) {
      if (request.owner !== owner) continue;
      this.rememberLateResource(id, request);
      this.#pending.delete(id);
      request.reject(new PlatformError('session_unavailable'));
    }
  }

  /** 只短暂保留无凭据的资源创建身份，避免取消后的孤立 attach 长期挂在共享 Socket。 */
  private rememberLateResource(id: number, request: PendingCommand): void {
    if (!['Target.attachToTarget', 'Target.createTarget'].includes(request.method)) return;
    this.#lateResources.set(id, {
      owner: request.owner,
      method: request.method,
      timer: setTimeout(() => {
        this.#lateResources.delete(id);
      }, 5000),
    });
  }

  /** detach 只针对本租约创建的 attach，超时与断线均不重试。 */
  public async detach(owner: CdpConnectionLease): Promise<void> {
    const sessions = [...this.#sessions].filter(([, lease]) => lease === owner);
    await Promise.all(
      sessions.map(async ([sessionId]) => {
        if (this.open)
          await this.call(
            owner,
            'Target.detachFromTarget',
            { sessionId },
            undefined,
            AbortSignal.timeout(5000),
          ).catch(() => undefined);
        this.#sessions.delete(sessionId);
      }),
    );
  }

  /** 只在全部授权等待者取消时关闭未建立的连接，已授权空闲连接保留。 */
  public remove(owner: CdpConnectionLease): void {
    this.cancel(owner);
    this.#leases.delete(owner);
    if (!this.#opened && this.#leases.size === 0) this.#socket.close();
  }

  /** Worker 退出先清理页面租约，再释放物理连接。 */
  public async dispose(): Promise<void> {
    await Promise.all([...this.#leases].map((lease) => lease.release()));
    this.#socket.close();
  }
}
