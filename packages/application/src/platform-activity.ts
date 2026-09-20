import { z } from 'zod';
import {
  platformRetentionSummarySchema,
  type PlatformRetentionSummary,
} from './contracts/platform-retention.js';
export {
  platformRetentionSummarySchema,
  type PlatformRetentionSummary,
} from './contracts/platform-retention.js';

/** 本地用户活动端口；不允许执行清理或访问上游。 */
export interface PlatformActivityRepository {
  touch(jobId: string, now: number): boolean;
  retentionSummary(): PlatformRetentionSummary;
}

/** 可见详情浏览同步落库，避免排队延迟造成清理竞态。 */
export class PlatformActivityService {
  public constructor(
    private readonly repository: PlatformActivityRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /** 服务端时间单调更新；官网及已删除职位不受影响。 */
  public touch(jobId: unknown): { updated: boolean } {
    // 1、校验正式职位身份；2、端口以短原子 UPDATE 更新交互时间。
    return { updated: this.repository.touch(z.uuidv7().parse(jobId), this.now()) };
  }

  /** 只读设置，不扫描职位或发布维护任务。 */
  public retentionSummary(): PlatformRetentionSummary {
    return platformRetentionSummarySchema.parse(this.repository.retentionSummary());
  }
}
