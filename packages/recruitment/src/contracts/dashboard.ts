/** 首页匹配计算需要的最小招聘事实快照，不包含职位正文。 */
export interface DashboardJobSnapshot {
  readonly id: string;
  readonly companyName: string;
  readonly title: string;
  readonly locations: readonly string[];
  readonly status: string;
  readonly latestRevisionId: string | null;
  readonly publishedAt: number | null;
  readonly updatedAt: number;
  readonly firstSeenAt: number;
}

/** 招聘模块拥有的首页计数与来源状态。 */
export interface RecruitmentDashboardSnapshot {
  readonly activeJobs: number;
  readonly sources: { readonly healthy: number; readonly total: number };
  readonly latestSync: {
    readonly sourceName: string;
    readonly status: string;
    readonly finishedAt: string;
  } | null;
  readonly jobs: readonly DashboardJobSnapshot[];
}

/** 所有者边界内统一读取招聘快照，供入口聚合展示。 */
export interface RecruitmentDashboardReader {
  snapshot(): RecruitmentDashboardSnapshot;
}
