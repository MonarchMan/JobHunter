import {
  platformRetentionStateSchema,
  type PlatformActivityRepository,
  type PlatformRetentionSummary,
} from '@jobhunter/application';
import type Database from 'better-sqlite3';
import { SqliteSettingsStore } from './settings.js';

/** Web 仅可更新本地交互与读取安全策略投影，不能执行删除。 */
export class SqlitePlatformActivityRepository implements PlatformActivityRepository {
  public constructor(private readonly client: Database.Database) {}

  /** 单语句写锁与清理互斥；不更改核验时间、修订或官网职位。 */
  public touch(jobId: string, now: number): boolean {
    // 1、限定平台正式职位；2、重复或较旧的时钟值不得回退活动时间。
    return (
      this.client
        .prepare(
          "UPDATE jobs SET last_interacted_at=max(coalesce(last_interacted_at,0),?) WHERE id=? AND source_id IN (SELECT id FROM job_sources WHERE source_kind='platform')",
        )
        .run(now, jobId).changes > 0
    );
  }

  /** 确认令牌不进入前端；损坏配置报错而不谎报停用。 */
  public retentionSummary(): PlatformRetentionSummary {
    // 1、缺省关闭；2、已有设置严格验证后只返回安全字段。
    const value = new SqliteSettingsStore(this.client).get('platform.retention');
    if (value === undefined || value === null)
      return { enabled: false, policy: { retentionDays: 30, intervalHours: 6 } };
    const state = platformRetentionStateSchema.parse(value);
    return { enabled: state.enabled, policy: state.policy };
  }
}
