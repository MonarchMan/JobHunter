import type { RecruitmentDashboardReader } from '@jobhunter/recruitment/contracts/dashboard';
import type { ProfileIdentityReader } from '@jobhunter/user/contracts';
import type { SqliteMatchingDashboardReader } from '@jobhunter/matching/persistence/dashboard-reader';
import type { TaskService } from '@jobhunter/common/tasks';
import type { DashboardReadModel } from './query-service.js';
import type { WebDashboard, WebDashboardNextAction } from '../../shared/dashboard-contracts.js';

/** Web 首页组合四模块的公开只读查询，不访问任何业务表。 */
export class DashboardSnapshotReader implements DashboardReadModel {
  public constructor(
    private readonly recruitment: RecruitmentDashboardReader,
    private readonly matching: Pick<SqliteMatchingDashboardReader, 'snapshot'>,
    private readonly profiles: ProfileIdentityReader,
    private readonly tasks: Pick<TaskService, 'summary'>,
  ) {}

  public snapshot(): WebDashboard {
    // 1、分别取得所有者快照，再将招聘事实交给匹配投影进行关联。
    const recruitment = this.recruitment.snapshot();
    const matching = this.matching.snapshot(recruitment.jobs);
    const tasks = this.tasks.summary();
    // 2、按首次配置、来源、失败任务、新匹配的既定优先级生成行动提示。
    let nextAction: WebDashboardNextAction | null = null;
    if (!this.profiles.hasProfiles())
      nextAction = { type: 'create_profile', message: '建立简历画像是第一步', href: '/profile' };
    else if (!recruitment.sources.total)
      nextAction = { type: 'enable_sources', message: '启用至少一个招聘来源', href: '/sources' };
    else if (tasks.failed > 0)
      nextAction = {
        type: 'handle_failures',
        message: `${String(tasks.failed)} 个任务需要处理`,
        count: tasks.failed,
        href: '/tasks?status=failed',
      };
    else if (matching.recentHighScoreCount > 0)
      nextAction = {
        type: 'review_matches',
        message: `${String(matching.recentHighScoreCount)} 个新匹配职位待查看`,
        count: matching.recentHighScoreCount,
        topJob: matching.topJob,
        href: '/jobs?sort=score_desc',
      };
    else if (matching.currentMatches > 0)
      nextAction = { type: 'all_good', message: '工作台运行正常，继续关注新职位' };
    return {
      activeJobs: recruitment.activeJobs,
      currentMatches: matching.currentMatches,
      sources: recruitment.sources,
      tasks: { pending: tasks.pending, failed: tasks.failed },
      latestSync: recruitment.latestSync,
      nextAction,
      highlightJobs: matching.highlightJobs,
    };
  }
}
