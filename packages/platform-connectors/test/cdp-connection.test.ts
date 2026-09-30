import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CdpConnectionManager, type CdpConnectionLease } from '../src/cdp-connection.js';
import { BossCdpSessionProvider, Job51CdpSessionProvider } from '../src/cdp.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

/** 合成浏览器命令；不接触真实页面、认证和官网请求。 */
interface Command {
  id: number;
  method: string;
  sessionId?: string;
  params: Record<string, unknown>;
}

/** 为每个 attach 分配唯一 sessionId，模拟浏览器级命令复用。 */
class MultiplexSocket extends EventTarget {
  static OPEN = 1;
  static instances: MultiplexSocket[] = [];
  static openDelay = 0;
  readyState = 0;
  readonly commands: Command[] = [];
  readonly silent = new Set<string>();
  failMethod: string | undefined;
  #targets = 0;
  #sessions = 0;

  public constructor(public readonly url: string) {
    super();
    MultiplexSocket.instances.push(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }, MultiplexSocket.openDelay);
  }

  public send(data: string): void {
    const command = JSON.parse(data) as Command;
    this.commands.push(command);
    if (this.silent.has(command.method)) return;
    let result: unknown = {};
    switch (command.method) {
      case 'Target.createTarget':
        result = { targetId: `target-${String(++this.#targets)}` };
        break;
      case 'Target.attachToTarget':
        result = { sessionId: `session-${String(++this.#sessions)}` };
        break;
      case 'Target.closeTarget':
        result = { success: true };
        break;
      case 'Target.getTargets':
        result = {
          targetInfos: [
            { targetId: 'borrowed', type: 'page', url: 'https://www.zhipin.com/web/geek/jobs' },
          ],
        };
        break;
    }
    queueMicrotask(() => {
      this.message(
        command.method === this.failMethod
          ? { id: command.id, error: { code: -32001, message: 'synthetic failure' } }
          : { id: command.id, result },
      );
    });
  }

  /** 支持迟到、乱序响应与指定页面事件。 */
  public message(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  public close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const managers: CdpConnectionManager[] = [];
/** 夹具缺失应直接失败，不用非空断言掩盖测试装配错误。 */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing synthetic fixture');
  return value;
}
/** 每个测试显式拥有连接管理器，结束后关闭，不使用共享全局实例。 */
function manager(): CdpConnectionManager {
  const instance = new CdpConnectionManager();
  managers.push(instance);
  return instance;
}

/** 推进合成授权事件，所有后续动作仍复用同一管理器。 */
async function acquire(
  pool: CdpConnectionManager,
  portFile = '/profile/DevToolsActivePort',
): Promise<CdpConnectionLease> {
  const pending = pool.acquire(portFile, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1);
  return pending;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, milliseconds);
    return controller.signal;
  });
  vi.mocked(readFile).mockResolvedValue('9222\n/devtools/browser/test');
  MultiplexSocket.instances = [];
  MultiplexSocket.openDelay = 0;
  vi.stubGlobal('WebSocket', MultiplexSocket);
});

afterEach(async () => {
  for (const socket of MultiplexSocket.instances) socket.silent.clear();
  const closed = Promise.all(managers.splice(0).map((pool) => pool.close()));
  await vi.advanceTimersByTimeAsync(10_001);
  await closed;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('同端点四个并发租约只建立一个 Socket，命令乱序响应和页面事件不串流', async () => {
  const pool = manager();
  const pending = Promise.all(
    Array.from({ length: 4 }, () =>
      pool.acquire('/profile/DevToolsActivePort', new AbortController().signal),
    ),
  );
  await vi.advanceTimersByTimeAsync(1);
  const leases = await pending;
  expect(MultiplexSocket.instances).toHaveLength(1);
  const socket = required(MultiplexSocket.instances[0]);
  const observers = leases.map((lease) => {
    const observer = vi.fn();
    lease.observe(observer);
    return observer;
  });
  const attached = (await Promise.all(
    leases.map((lease, index) =>
      lease.call(
        'Target.attachToTarget',
        { targetId: `page-${String(index)}`, flatten: true },
        undefined,
        new AbortController().signal,
      ),
    ),
  )) as { sessionId: string }[];
  socket.silent.add('Runtime.evaluate');
  const reads = leases.map((lease, index) =>
    lease.call(
      'Runtime.evaluate',
      {},
      required(attached[index]).sessionId,
      new AbortController().signal,
    ),
  );
  const commands = socket.commands.filter((command) => command.method === 'Runtime.evaluate');
  for (const [index, command] of [...commands.entries()].reverse())
    socket.message({ id: command.id, result: index });
  expect(await Promise.all(reads)).toEqual([0, 1, 2, 3]);
  for (const [index, session] of attached.entries()) {
    socket.message({
      sessionId: session.sessionId,
      method: 'Network.requestWillBeSent',
      params: { index },
    });
    expect(observers[index]).toHaveBeenCalledTimes(1);
  }
  expect(observers.every((observer) => observer.mock.calls.length === 1)).toBe(true);
  expect(new Set(socket.commands.map((command) => command.id)).size).toBe(socket.commands.length);
  await expect(
    required(leases[0]).call(
      'Runtime.evaluate',
      {},
      required(attached[1]).sessionId,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
  await expect(
    required(leases[0]).call(
      'Target.detachFromTarget',
      { sessionId: required(attached[1]).sessionId },
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
});

it('跨平台和 BOSS 两个关键词共用连接，单页断开及初始化失败不影响其他页', async () => {
  const connections = manager();
  const boss = new BossCdpSessionProvider({ connections });
  const job51 = new Job51CdpSessionProvider({ connections });
  const pending = Promise.all([
    boss.connect({ search: { keyword: '后端开发', city: '' } }, new AbortController().signal),
    boss.connect({ search: { keyword: '算法工程师', city: '' } }, new AbortController().signal),
    job51.connect({}, new AbortController().signal),
  ]);
  await vi.advanceTimersByTimeAsync(1);
  const sessions = await pending;
  const socket = required(MultiplexSocket.instances[0]);
  expect(MultiplexSocket.instances).toHaveLength(1);
  const disconnected = vi.fn();
  sessions[2].onDisconnected?.(disconnected);
  expect(
    socket.commands.filter((command) => command.method === 'Target.createTarget'),
  ).toHaveLength(3);
  sessions[0].disconnect();
  await vi.advanceTimersByTimeAsync(1);
  expect(
    socket.commands
      .filter((command) => command.method === 'Target.closeTarget')
      .map((command) => command.params.targetId),
  ).toEqual(['target-1']);
  expect(socket.readyState).toBe(1);
  expect(disconnected).not.toHaveBeenCalled();
  socket.failMethod = 'Network.enable';
  await expect(job51.connect({}, new AbortController().signal)).rejects.toMatchObject({
    category: 'session_unavailable',
  });
  expect(
    socket.commands
      .filter((command) => command.method === 'Target.closeTarget')
      .map((command) => command.params.targetId),
  ).toEqual(['target-1', 'target-4']);
  expect(disconnected).not.toHaveBeenCalled();
  expect(socket.readyState).toBe(1);
  expect(
    socket.commands.some((command) =>
      ['Page.reload', 'Page.bringToFront', 'Browser.close'].includes(command.method),
    ),
  ).toBe(false);
  await connections.close();
  expect(socket.readyState).toBe(3);
  expect(socket.commands.filter((command) => command.method === 'Target.closeTarget')).toHaveLength(
    4,
  );
});

it('借用页断开只 detach，全部租约释放后下一次连接仍复用授权 Socket', async () => {
  const connections = manager();
  const pending = new BossCdpSessionProvider({ connections }).connect(
    { targetId: 'borrowed' },
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(1);
  (await pending).disconnect();
  await vi.advanceTimersByTimeAsync(1);
  const socket = required(MultiplexSocket.instances[0]);
  expect(
    socket.commands.filter((command) => command.method === 'Target.detachFromTarget'),
  ).toHaveLength(1);
  expect(socket.commands.some((command) => command.method === 'Target.closeTarget')).toBe(false);
  const lease = await acquire(connections);
  expect(MultiplexSocket.instances).toHaveLength(1);
  await lease.call('Target.getTargets', {}, undefined, new AbortController().signal);
  expect(socket.readyState).toBe(1);
});

it('取消一个授权等待者不影响其他等待者，全部取消才关闭未授权连接', async () => {
  MultiplexSocket.openDelay = 30_000;
  const pool = manager(),
    first = new AbortController(),
    second = new AbortController();
  const a = pool
    .acquire('/profile/DevToolsActivePort', first.signal)
    .catch((error: unknown) => error);
  const b = pool.acquire('/profile/DevToolsActivePort', second.signal);
  await vi.advanceTimersByTimeAsync(1);
  first.abort();
  expect(await a).toMatchObject({ category: 'session_unavailable' });
  expect(required(MultiplexSocket.instances[0]).readyState).toBe(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await b).available).toBe(true);
  const another = manager(),
    controller = new AbortController();
  const cancelled = another
    .acquire('/profile/DevToolsActivePort', controller.signal)
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect(await cancelled).toMatchObject({ category: 'session_unavailable' });
  expect(required(MultiplexSocket.instances[1]).readyState).toBe(3);
  expect(required(MultiplexSocket.instances[0]).readyState).toBe(1);
});

it.each(['cancel', 'timeout'] as const)(
  '命令 %s 只拒绝自己的请求，迟到响应不污染其他租约',
  async (mode) => {
    const pool = manager(),
      a = await acquire(pool),
      b = await acquire(pool);
    const socket = required(MultiplexSocket.instances[0]);
    socket.silent.add('Target.getTargets');
    const controller = new AbortController();
    const failed = a
      .call('Target.getTargets', {}, undefined, controller.signal)
      .catch((error: unknown) => error);
    const command = required(socket.commands.at(-1));
    if (mode === 'cancel') controller.abort();
    else await vi.advanceTimersByTimeAsync(20_001);
    expect(await failed).toMatchObject({ category: 'session_unavailable' });
    socket.message({ id: command.id, result: 'late' });
    socket.silent.clear();
    expect(
      await b.call('Target.getTargets', {}, undefined, new AbortController().signal),
    ).toHaveProperty('targetInfos');
    expect(socket.readyState).toBe(1);
    expect(MultiplexSocket.instances).toHaveLength(1);
  },
);

it('真正断线使全部租约失效，只在下一次明确 acquire 时建立新连接', async () => {
  const pool = manager(),
    a = await acquire(pool),
    b = await acquire(pool);
  const first = vi.fn(),
    second = vi.fn();
  a.onDisconnected(first);
  b.onDisconnected(second);
  required(MultiplexSocket.instances[0]).close();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(a.available).toBe(false);
  expect(b.available).toBe(false);
  const late = vi.fn();
  a.onDisconnected(late);
  expect(late).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(MultiplexSocket.instances).toHaveLength(1);
  await acquire(pool);
  expect(MultiplexSocket.instances).toHaveLength(2);
});

it('不同端点和不同 Worker 管理器独立，关闭一个不影响另一个', async () => {
  const first = manager(),
    second = manager();
  await acquire(first);
  vi.mocked(readFile).mockResolvedValueOnce('9333\n/devtools/browser/other');
  const otherBrowser = await acquire(first, '/other/DevToolsActivePort');
  const otherWorker = await acquire(second);
  expect(MultiplexSocket.instances).toHaveLength(3);
  await first.close();
  expect(otherBrowser.available).toBe(false);
  expect(otherWorker.available).toBe(true);
  await expect(
    first.acquire('/profile/DevToolsActivePort', new AbortController().signal),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
});

it('单个页面观察器异常不会中断其他租约的事件与命令', async () => {
  const pool = manager(),
    a = await acquire(pool),
    b = await acquire(pool);
  const attached = (await a.call(
    'Target.attachToTarget',
    { targetId: 'page' },
    undefined,
    new AbortController().signal,
  )) as { sessionId: string };
  const failed = vi.fn(),
    unaffected = vi.fn();
  a.onDisconnected(failed);
  b.onDisconnected(unaffected);
  a.setCleanup(async () => {
    await a.call(
      'Target.closeTarget',
      { targetId: 'page' },
      undefined,
      new AbortController().signal,
    );
  });
  a.observe(() => {
    throw new Error('synthetic observer failure');
  });
  required(MultiplexSocket.instances[0]).message({
    sessionId: attached.sessionId,
    method: 'Page.frameNavigated',
  });
  expect(failed).toHaveBeenCalledTimes(1);
  expect(unaffected).not.toHaveBeenCalled();
  expect(
    await b.call('Target.getTargets', {}, undefined, new AbortController().signal),
  ).toHaveProperty('targetInfos');
  await a.release();
  expect(
    required(MultiplexSocket.instances[0]).commands.some(
      (command) => command.method === 'Target.closeTarget',
    ),
  ).toBe(true);
});

it.each([
  ['Target.attachToTarget', { sessionId: 'late-session' }, 'Target.detachFromTarget'],
  ['Target.createTarget', { targetId: 'late-page' }, 'Target.closeTarget'],
] as const)('释放后迟到的 %s 只清理自身资源，不交付旧结果', async (method, result, cleanup) => {
  const pool = manager(),
    a = await acquire(pool),
    b = await acquire(pool);
  const socket = required(MultiplexSocket.instances[0]);
  socket.silent.add(method);
  const pending = a
    .call(method, { url: 'about:blank', targetId: 'page' }, undefined, new AbortController().signal)
    .catch((error: unknown) => error);
  const command = required(socket.commands.at(-1));
  await a.release();
  expect(await pending).toMatchObject({ category: 'session_unavailable' });
  socket.message({ id: command.id, result });
  await vi.advanceTimersByTimeAsync(1);
  expect(socket.commands.at(-1)).toMatchObject({ method: cleanup, params: result });
  expect(b.available).toBe(true);
  expect(socket.readyState).toBe(1);
});

it('Worker 退出清理有五秒上限，借用页不因 detach 超时被关闭', async () => {
  const pool = manager(),
    lease = await acquire(pool);
  await lease.call(
    'Target.attachToTarget',
    { targetId: 'borrowed' },
    undefined,
    new AbortController().signal,
  );
  const socket = required(MultiplexSocket.instances[0]);
  socket.silent.add('Target.detachFromTarget');
  const closing = pool.close();
  await vi.advanceTimersByTimeAsync(5001);
  await closing;
  expect(socket.readyState).toBe(3);
  expect(socket.commands.some((command) => command.method === 'Target.closeTarget')).toBe(false);
});
