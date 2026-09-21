import { setTimeout as delay } from 'node:timers/promises';
import type { PlatformProviderKey } from '@jobhunter/platform-core';
import { bossResultSchema, type BossResult } from './platforms.js';
import type { TaskService } from './tasks/task-service.js';
import type { TaskRecord } from './tasks/model.js';

/** 独立平台的一轮观察；外部提供截止时间，不创建浏览器、重试或重复详情。 */
export async function observePlatformRound(input: {
  provider: PlatformProviderKey;
  generation: number;
  round: number;
  deadline: number;
  tasks: Pick<TaskService, 'enqueue' | 'get' | 'list' | 'cancel'>;
  connection: () => { generation: number; status: string } | null;
  verifySaved: (result: BossResult, task: TaskRecord) => void;
  now?: () => number;
  wait?: () => Promise<void>;
}): Promise<{
  provider: PlatformProviderKey;
  round: number;
  status: 'passed' | 'exhausted';
  taskId: string;
  saved: number;
  skipped: number;
  detailVerified: boolean;
}> {
  const now = input.now ?? Date.now;
  const taskType = `platform.${input.provider}`;
  const key = (round: number): string =>
    `${input.provider}:stability:${String(input.generation)}:${String(round)}:next`;
  /** 精确匹配幂等键，其他动作的历史不能挤掉观察结果。 */
  const find = (round: number): TaskRecord | undefined => {
    for (let offset = 0; ; offset += 100) {
      const rows = input.tasks.list({ taskType, limit: 100, offset });
      const found = rows.find((task) => task.idempotencyKey === key(round));
      if (found || rows.length < 100) return found;
    }
  };
  /** 只承认本平台同代次整批保存，旧单详情结果不能作为观察成功。 */
  const validate = (task: TaskRecord): BossResult => {
    const result = bossResultSchema.parse(task.result);
    if (
      task.taskType !== taskType ||
      task.status !== 'succeeded' ||
      result.generation !== input.generation ||
      result.status !== 'available' ||
      !result.candidates ||
      typeof result.hasMore !== 'boolean' ||
      result.savedCount !== result.candidates.length
    )
      throw new Error('Observation batch did not complete.');
    input.verifySaved(result, task);
    return result;
  };
  const summary = (
    task: TaskRecord,
    result: BossResult,
  ): Awaited<ReturnType<typeof observePlatformRound>> => ({
    provider: input.provider,
    round: input.round,
    status: result.hasMore === false ? 'exhausted' : 'passed',
    taskId: String(task.id),
    saved: result.savedCount ?? 0,
    skipped: result.skippedMissingCompanyId ?? 0,
    detailVerified: (result.savedCount ?? 0) > 0,
  });
  // 1、只检查本平台此前轮次；末批正常结束，另一平台失败不参与判断。
  for (let round = 0; round < input.round; round++) {
    const previous = find(round);
    if (previous?.status !== 'succeeded')
      throw new Error('Previous observation did not complete; observation stopped.');
    const result = validate(previous);
    if (!result.hasMore) return summary(previous, result);
  }
  let task = find(input.round);
  if (!task) {
    const connection = input.connection();
    if (
      connection?.generation !== input.generation ||
      !['connected', 'available'].includes(connection.status)
    )
      throw new Error('Original session is unavailable; observation stopped.');
    if (now() >= input.deadline) throw new Error('Observation deadline passed.');
    const submitted = input.tasks.enqueue({
      taskType,
      payload: { action: 'next', generation: input.generation },
      idempotencyKey: key(input.round),
    });
    if (submitted.kind === 'concurrency_conflict')
      throw new Error('Another action for this platform is active.');
    task = submitted.task;
  }
  // 2、整批可超过 90 秒；只受显式截止约束，超时仅取消本轮平台任务。
  for (;;) {
    const current = input.tasks.get(task.id);
    if (current?.status === 'succeeded') return summary(current, validate(current));
    if (!current || current.status === 'failed' || current.status === 'cancelled')
      throw new Error('Observation stopped; inspect this platform task diagnostics.');
    if (now() >= input.deadline) {
      input.tasks.cancel(task.id);
      throw new Error('Observation deadline passed; cancellation requested.');
    }
    await (input.wait ?? (() => delay(1000)))();
  }
}
