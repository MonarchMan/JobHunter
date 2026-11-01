import type Database from 'better-sqlite3';
import { z } from 'zod';
import type {
  CleanupDataParticipant,
  CleanupCandidate,
  CleanupRepository,
} from '@jobhunter/common/operations/cleanup-service';

/** 招聘所有者提供过期观察与临时详情的清理，不触碰职位当前事实。 */
export class SqliteRecruitmentCleanupParticipant implements CleanupDataParticipant {
  public constructor(private readonly client: Database.Database) {}

  /** 保持原来的时间阈值与候选身份编码。 */
  public listCandidates(
    cutoffs: Parameters<CleanupRepository['listCandidates']>[0],
  ): readonly CleanupCandidate[] {
    // 1、分别读取观察与临时详情候选，始终不删除职位当前事实。
    const schema = z.array(z.object({ id: z.string(), created_at: z.number() }));
    const observations = schema.parse(
      this.client
        .prepare(
          'SELECT json_array(job_id,sync_run_id) AS id, observed_at AS created_at FROM job_observations WHERE observed_at<? AND sync_run_id IS NOT NULL',
        )
        .all(cutoffs.observationsBefore),
    );
    const details = schema.parse(
      this.client
        .prepare(
          'SELECT json_array(source_id,external_job_id) AS id, updated_at AS created_at FROM source_job_details WHERE updated_at<?',
        )
        .all(cutoffs.sourceDetailsBefore),
    );
    return [
      ...observations.map((row) => ({
        kind: 'observation' as const,
        id: row.id,
        createdAt: row.created_at,
        relativePath: null,
        bytes: 0,
      })),
      ...details.map((row) => ({
        kind: 'source_detail' as const,
        id: row.id,
        createdAt: row.created_at,
        relativePath: null,
        bytes: 0,
      })),
    ];
  }

  /** 调用方的同步事务负责原子性，参与者不另开外部操作。 */
  public deleteCandidates(candidates: readonly CleanupCandidate[]): void {
    for (const candidate of candidates) {
      if (candidate.kind !== 'observation' && candidate.kind !== 'source_detail') continue;
      const ids = z.tuple([z.string(), z.string()]).parse(JSON.parse(candidate.id) as unknown);
      if (candidate.kind === 'observation')
        this.client
          .prepare('DELETE FROM job_observations WHERE job_id=? AND sync_run_id=?')
          .run(...ids);
      else
        this.client
          .prepare('DELETE FROM source_job_details WHERE source_id=? AND external_job_id=?')
          .run(...ids);
    }
  }
}
