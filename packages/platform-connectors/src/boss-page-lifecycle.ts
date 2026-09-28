import { setTimeout as delay } from 'node:timers/promises';
import { PlatformError } from '@jobhunter/platform-core';
import type { BossPageState } from './boss-page-state.js';

/** 两种 BOSS 传输共用的页面生命周期；不持有认证信息、响应或职位数据。 */
export class BossPageLifecycle {
  readonly #abort = new AbortController();
  #epoch = 0;
  #locked = false;
  #renewalPhase: 'none' | 'clicked' | 'security' | 'returned' = 'none';
  #lastNavigationAt = 0;
  #failure: PlatformError | undefined;

  public constructor(
    private readonly input: {
      readonly allowInitialNavigation: boolean;
      readonly inspectPage?: ((signal: AbortSignal) => Promise<BossPageState>) | undefined;
    },
  ) {}

  /** 当前文档代次仅在内存使用，异步结果交付前必须复核。 */
  public get epoch(): number {
    return this.#epoch;
  }
  /** 页面失效可中止所有使用当前上下文的在途操作。 */
  public get signal(): AbortSignal {
    return this.#abort.signal;
  }

  /** 断线或所有者释放时失效，不主动关闭浏览器或重连。 */
  public disconnect(): void {
    this.#fail('browser_disconnected');
  }

  /** 数据工作集开始后不允许跨文档沿用候选或认证上下文。 */
  public lock(): void {
    this.assertCurrent();
    this.#locked = true;
  }

  /** 仅 HTTP 详情 37 的自有页点击期间，允许官网一次安全检查并自然返回。 */
  public beginSessionRenewal(): void {
    this.assertCurrent();
    if (!this.#locked || this.#renewalPhase !== 'none')
      throw new PlatformError('session_unavailable');
    this.#renewalPhase = 'clicked';
  }

  /** 恢复结束即收回例外，不允许下一次导航借用上次窗口。 */
  public endSessionRenewal(): void {
    this.#renewalPhase = 'none';
  }

  /** 初始化同源导航只切换代次；跨站与锁定后导航立即失效。 */
  public navigate(url: string | undefined): void {
    if (this.#failure) return;
    let allowed = url === 'about:blank';
    try {
      allowed ||= !!url && new URL(url).origin === 'https://www.zhipin.com';
    } catch {
      /* 无效地址按非预期页面处理。 */
    }
    // 1、只接收已观察到的一次官网安全检查及自然返回；不操作验证控件。
    if (this.#locked && url) {
      try {
        const destination = new URL(url);
        if (
          destination.origin === 'https://www.zhipin.com' &&
          destination.pathname === '/web/passport/zp/security.html'
        ) {
          if (this.#renewalPhase === 'clicked') {
            this.#renewalPhase = 'security';
            this.#epoch++;
            this.#lastNavigationAt = Date.now();
            return;
          }
          this.#fail('verification_required', 'access_blocked');
          return;
        }
        if (
          destination.origin === 'https://www.zhipin.com' &&
          destination.pathname === '/web/geek/jobs' &&
          this.#renewalPhase === 'security'
        ) {
          this.#renewalPhase = 'returned';
          this.#epoch++;
          this.#lastNavigationAt = Date.now();
          return;
        }
      } catch {
        /* 无效地址继续按锁定后的失效处理。 */
      }
    }
    if (this.#locked || !this.input.allowInitialNavigation || !allowed) {
      this.#fail(this.#locked ? 'page_navigated' : 'unexpected_page');
      return;
    }
    // 1、旧文档观察由调用者按 epoch 清理，不在公共组件保存传输状态。
    this.#epoch++;
    this.#lastNavigationAt = Date.now();
  }

  /** 异步读取前后检查页面状态，拒绝旧文档迟到的凭据或响应。 */
  public assertCurrent(epoch = this.#epoch): void {
    if (this.#failure) throw this.#failure;
    if (epoch !== this.#epoch)
      throw new PlatformError('session_unavailable', null, 'page_navigated');
  }

  /** 页面和调用方就绪条件共同满足才返回；只读观察受独立截止与取消约束。 */
  public async waitReady(
    signal: AbortSignal,
    options: {
      readonly timeoutMs: number;
      readonly available?: ((signal: AbortSignal) => boolean | Promise<boolean>) | undefined;
    },
  ): Promise<number> {
    const deadline = AbortSignal.timeout(options.timeoutMs);
    const operationSignal = AbortSignal.any([signal, this.signal, deadline]);
    let previousRisk: BossPageState | undefined;
    let lastState: BossPageState = 'loading';
    try {
      for (;;) {
        operationSignal.throwIfAborted();
        this.assertCurrent();
        const epoch = this.epoch;
        // 1、只读探针跨导航完成时丢弃，避免把旧页 ready 或风险用于新文档。
        try {
          lastState = this.input.inspectPage
            ? await this.input.inspectPage(operationSignal)
            : 'ready';
        } catch {
          operationSignal.throwIfAborted();
          if (epoch !== this.epoch) continue;
          throw new PlatformError('session_unavailable', null, 'page_state_unavailable');
        }
        if (epoch !== this.epoch) {
          previousRisk = undefined;
          continue;
        }
        this.assertCurrent(epoch);
        // 2、页面风险连续两次一致才停止，URL 检查标记不直接作为风险。
        if (lastState !== 'ready' && lastState !== 'loading') {
          if (lastState === previousRisk)
            throw new PlatformError(
              lastState === 'access_blocked' || lastState === 'verification_required'
                ? 'access_blocked'
                : lastState === 'rate_limited'
                  ? 'rate_limited'
                  : 'session_unavailable',
              null,
              lastState,
            );
          previousRisk = lastState;
        } else previousRisk = undefined;
        // 3、传输只提供有无有效数据，不向公共组件传递列表正文或认证数据。
        if (lastState === 'ready' && Date.now() - this.#lastNavigationAt >= 1000) {
          const available = options.available ? await options.available(operationSignal) : true;
          if (epoch === this.epoch) {
            this.assertCurrent(epoch);
            operationSignal.throwIfAborted();
            if (available) return epoch;
          }
        }
        await delay(this.input.inspectPage ? 1000 : 50, undefined, { signal: operationSignal });
      }
    } catch (error) {
      // 4、取消／页面失效优先于超时；原探针或传输错误保留固定诊断。
      signal.throwIfAborted();
      this.assertCurrent();
      if (deadline.aborted)
        throw new PlatformError(
          'session_unavailable',
          null,
          lastState === 'ready' ? 'list_response_timeout' : 'page_not_ready',
        );
      throw error;
    }
  }

  /** 保留首次页面失效原因，避免清理时覆盖诊断现场。 */
  #fail(
    reason: string,
    category: 'session_unavailable' | 'access_blocked' = 'session_unavailable',
  ): void {
    this.#failure ??= new PlatformError(category, null, reason);
    this.#abort.abort();
  }
}
