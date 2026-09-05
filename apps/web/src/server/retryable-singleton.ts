/** 合并并发初始化；成功复用，失败仅短暂缓存以避免重试风暴。 */
export function createRetryableSingleton<T>(
  factory: () => Promise<T>,
  now: () => number = Date.now,
): () => Promise<T> {
  let pending: Promise<T> | undefined;
  let retryAt = Number.POSITIVE_INFINITY;
  return () => {
    // 1、只有上一次已失败且冷却到期才替换 Promise，进行中的请求始终共享。
    if (!pending || now() >= retryAt) {
      retryAt = Number.POSITIVE_INFINITY;
      pending = Promise.resolve()
        .then(factory)
        .catch((error: unknown) => {
          // 2、保留原始错误供调用方处理，下一次请求负责重试，不启动后台重试循环。
          retryAt = now() + 1000;
          throw error;
        });
    }
    return pending;
  };
}
