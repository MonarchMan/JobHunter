import type Database from 'better-sqlite3';
import type { ProfileVersionId } from '@jobhunter/common/domain';
import type { JobScoreSnapshotReader } from '@jobhunter/recruitment/contracts/job-scores';
import { z } from 'zod';

/** 只读取匹配模块拥有的评分记录，不查询招聘侧的职位或修订表。 */
export class SqliteJobScoreReader implements JobScoreSnapshotReader {
  public constructor(private readonly client: Database.Database) {}

  /** 按画像版本读取最小评分快照，供入口组合招聘查询。 */
  public scores(profileVersionId: ProfileVersionId): ReturnType<JobScoreSnapshotReader['scores']> {
    // 1、在数据库边界校验评分与修订身份，不返回模型输入或完整匹配结果。
    return z
      .array(z.object({ jobRevisionId: z.uuidv7(), totalScore: z.number().min(0).max(100) }))
      .parse(
        this.client
          .prepare(
            'SELECT job_revision_id AS jobRevisionId, total_score AS totalScore FROM match_results WHERE profile_version_id = ?',
          )
          .all(profileVersionId),
      );
  }
}
