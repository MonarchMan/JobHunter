/** 平台采集的非敏感搜索计划，不含简历或用户仓储。 */
export interface PlatformProfileSearchPlan {
  readonly profileVersionId: string;
  readonly keywords: readonly string[];
}

/** 搜索条件派生由匹配模块提供，招聘模块只消费已经形成的计划。 */
export interface PlatformProfileSearchPlanProvider {
  plan(): PlatformProfileSearchPlan;
}
