import { z } from 'zod';
import type { PlatformProviderKey } from '@jobhunter/platform-core';
import { bossCommandSchema, bossResultSchema, type BossResult } from './platforms.js';
import type { TaskService } from './tasks/task-service.js';
import type { TaskStatus, EnqueueTaskResult } from './tasks/model.js';
import { platformFailureMessage, type PlatformProgress } from './platform-progress.js';

/** 页面状态仅含非敏感连接信息及受验证的推荐结果。 */
export interface WebBossSnapshot {
  connection: { generation: number; status: string } | null;
  batch: BossResult | null;
  targets?: BossResult['targets'];
  saved: Record<string, string>;
  task: {
    id: string;
    status: TaskStatus;
    error: string | null;
    progress?: PlatformProgress | null;
  } | null;
}

/** 页面只读取非敏感状态；不触碰 Worker 持有的认证上下文。 */
export interface PlatformConnectionReader {
  snapshot(): { generation: number; status: string } | null;
}

/** 幂等令牌避免提交响应丢失后重复发起上游动作。 */
export const webBossMutationSchema = z
  .object({
    command: bossCommandSchema,
    idempotencyToken: z.uuid(),
  })
  .strict();

/** 平台页面的任务发布与安全结果投影。 */
export class WebPlatformService {
  public constructor(
    private readonly repository: PlatformConnectionReader,
    private readonly tasks: TaskService,
    private readonly providerKey: PlatformProviderKey = 'boss',
  ) {}

  /** 从有限历史恢复最近一批；刷新页面不会执行网络采集。 */
  public snapshot(): WebBossSnapshot {
    // 1、仅投影当前代次结果，不返回原始 payload、调试路径或任务内部字段。
    const connection = this.repository.snapshot();
    const recent = this.tasks.list({ taskType: `platform.${this.providerKey}`, limit: 100 });
    let batch: BossResult | null = null;
    const saved = new Map<string, string>();
    for (const task of recent) {
      if (task.status !== 'succeeded') continue;
      const result = bossResultSchema.safeParse(task.result);
      const command = bossCommandSchema.safeParse(task.payload);
      if (!result.success || result.data.generation !== connection?.generation) continue;
      if (batch === null && result.data.candidates) batch = result.data;
      if (
        command.success &&
        command.data.action === 'detail' &&
        result.data.jobId &&
        !saved.has(command.data.externalJobId)
      )
        saved.set(command.data.externalJobId, result.data.jobId);
    }
    // 2、活动任务单独查询，不能因历史窗口截断而被隐藏。
    const active = this.tasks.list({
      taskType: `platform.${this.providerKey}`,
      statuses: ['pending', 'running'],
      limit: 1,
    })[0];
    const latest = active ?? recent[0];
    const current = bossResultSchema.safeParse(latest?.result);
    const progress =
      current.success && current.data.generation === connection?.generation
        ? (current.data.progress ?? null)
        : null;
    return {
      connection,
      ...(current.success &&
      current.data.generation === connection?.generation &&
      current.data.status === 'selection_required'
        ? { targets: current.data.targets }
        : {}),
      batch,
      saved: Object.fromEntries(saved),
      task: latest
        ? {
            id: String(latest.id),
            status: latest.status,
            progress,
            error:
              latest.status === 'failed' || latest.status === 'cancelled'
                ? progress?.failure
                  ? platformFailureMessage(progress.failure)
                  : latest.status === 'cancelled'
                    ? '任务已取消，已入库职位保留。'
                    : '操作失败，已停止请求。历史任务没有结构化诊断，请查看任务记录。'
                : null,
          }
        : null,
    };
  }

  /** Web 只入队，调试连接和上游调用均留在 Worker。 */
  public mutate(input: unknown): { kind: EnqueueTaskResult['kind']; taskId: string } {
    // 1、边界严格校验，重试同一令牌时由队列返回原任务。
    const mutation = webBossMutationSchema.parse(input);
    const result = this.tasks.enqueue({
      taskType: `platform.${this.providerKey}`,
      payload: mutation.command,
      idempotencyKey: `platform:${this.providerKey}:${mutation.idempotencyToken}`,
    });
    return { kind: result.kind, taskId: result.task.id };
  }
}

/** 保留 BOSS 页面调用兼容，其他平台需要显式独立装配。 */
export { WebPlatformService as WebBossService };
