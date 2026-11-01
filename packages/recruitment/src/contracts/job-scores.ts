import type { ProfileVersionId } from '@jobhunter/common/domain';

/** 招聘查询需要的只读评分快照，由入口注入匹配模块实现。 */
export interface JobScoreSnapshotReader {
  /** 一次返回指定画像版本的历史修订评分；招聘侧自行关联其拥有的职位修订。 */
  scores(profileVersionId: ProfileVersionId): readonly {
    readonly jobRevisionId: string;
    readonly totalScore: number;
  }[];
}
