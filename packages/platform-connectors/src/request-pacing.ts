import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

/** 每会话独立的正常请求间隔；不承担重试、风控恢复或并发策略。 */
export class PlatformRequestPacer {
  readonly #interval: number;
  #lastAt: number | null = null;

  public constructor(
    intervalMs = 0,
    private readonly now: () => number = Date.now,
  ) {
    this.#interval = z.number().int().min(0).max(60_000).parse(intervalMs);
  }

  /** 零间隔允许调用方保留原有同步起步语义，不插入额外异步边界。 */
  public get enabled(): boolean {
    return this.#interval > 0;
  }

  /** 原子分配请求开始时间，取消不占用下一次配额。 */
  public async before(signal?: AbortSignal | null): Promise<void> {
    // 1、零间隔不创建计时器；调用方原有互斥与并发限制仍有效。
    signal?.throwIfAborted();
    if (this.#interval === 0) return;
    // 2、唤醒后复核最近请求；检查和更新时间之间无 await，避免同时穿透。
    while (this.#lastAt !== null && this.now() - this.#lastAt < this.#interval) {
      await delay(this.#interval - (this.now() - this.#lastAt), undefined, {
        ...(signal ? { signal } : {}),
      });
    }
    signal?.throwIfAborted();
    this.#lastAt = this.now();
  }
}
