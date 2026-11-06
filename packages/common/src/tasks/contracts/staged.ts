import { classifyTaskError } from '../scheduling/retry-policy.js';
import type { TaskExecutionError } from '../scheduling/retry-policy.js';

/**
 * 逐项阶段执行的安全结果记录，可直接持久化到任务检查点。
 * result 只允许存放脱敏的阶段性结果（如 ID 与状态），不得包含敏感内容。
 */
export interface StagedItemResult {
  readonly key: string;
  readonly status: 'succeeded' | 'failed';
  readonly result: unknown;
  readonly error: string | null;
}

/** 应用层数据结构或端口契约。 */
export interface StagedItemsRunOptions {
  /** 全部工作项键，按执行顺序；重复键由调用方负责去重。 */
  readonly keys: readonly string[];
  /** 检查点恢复的既有结果；已成功项在所有重试中跳过。 */
  readonly previous?: readonly StagedItemResult[];
  readonly signal: AbortSignal;
  /** 每项结束后保存全量进度；实现负责将其合并进任务级检查点。 */
  readonly checkpoint?: (items: readonly StagedItemResult[]) => void;
  /** 执行单项；previous 为该项既有记录，供阶段内恢复（如只重跑失败子阶段）。 */
  readonly run: (key: string, previous: StagedItemResult | undefined) => Promise<unknown>;
  /** 取消时构造携带已完成进度的错误，由调用方决定错误类别与摘要。 */
  readonly onCancelled: (items: readonly StagedItemResult[]) => TaskExecutionError;
}

/**
 * 串行执行逐项阶段：已成功项跳过、失败项分类后继续、每项落一次检查点。
 * 1、按 keys 顺序处理，取消信号在每项开始前检查；
 * 2、单项失败不中断其余项，失败摘要经 classifyTaskError 脱敏；
 * 3、返回全量结果（含恢复的成功项），整体成败由调用方依据失败计数决定。
 */
export async function runStagedItems(
  options: StagedItemsRunOptions,
): Promise<readonly StagedItemResult[]> {
  const items = new Map(
    (options.previous ?? [])
      .filter((item) => options.keys.includes(item.key))
      .map((item) => [item.key, item]),
  );
  for (const key of options.keys) {
    if (options.signal.aborted) throw options.onCancelled([...items.values()]);
    const previous = items.get(key);
    if (previous?.status === 'succeeded') continue;
    let item: StagedItemResult;
    try {
      const result = await options.run(key, previous);
      item = { key, status: 'succeeded', result, error: null };
    } catch (error) {
      const classified = classifyTaskError(error);
      item = {
        key,
        status: 'failed',
        result: classified.result ?? null,
        error: classified.safeSummary,
      };
    }
    items.set(key, item);
    options.checkpoint?.([...items.values()]);
  }
  return [...items.values()];
}
