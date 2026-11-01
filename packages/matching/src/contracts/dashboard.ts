/** 首页匹配高亮投影，不携带用户资料或原始模型数据。 */
export interface DashboardHighlightJob {
  readonly id: string;
  readonly companyName: string;
  readonly title: string;
  readonly locations: string[];
  readonly score: number | null;
  readonly matchReasons: string[];
  readonly publishedAt: string | null;
  readonly updatedAt: string;
  readonly isNew: boolean;
}

/** 匹配模块提供的首页结果，由 Web 入口与招聘及任务状态组合。 */
export interface MatchingDashboardSnapshot {
  readonly currentMatches: number;
  readonly recentHighScoreCount: number;
  readonly topJob: {
    readonly id: string;
    readonly companyName: string;
    readonly title: string;
    readonly score: number;
  } | null;
  readonly highlightJobs: DashboardHighlightJob[];
}
